import cluster from 'cluster';
import os from 'os';
import Redis from 'ioredis';
import { ChunkData } from './models/Chunk';

const numCPUs = os.cpus().length;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  
  // Initialize Redis
  const redis = new Redis(REDIS_URL);
  const pubClient = new Redis(REDIS_URL);
  const subClient = new Redis(REDIS_URL);
  
  // Worker state tracking
  const workerStates = new Map<number, {
    load: number;
    lastHeartbeat: number;
    isResponsive: boolean;
  }>();

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    forkWorker();
  }

  function forkWorker() {
    const worker = cluster.fork();
    workerStates.set(worker.process.pid!, {
      load: 0,
      lastHeartbeat: Date.now(),
      isResponsive: true
    });

    worker.on('message', (msg) => {
      if (msg.type === 'load_update') {
        workerStates.get(worker.process.pid!)!.load = msg.load;
      } else if (msg.type === 'heartbeat') {
        workerStates.get(worker.process.pid!)!.lastHeartbeat = Date.now();
      }
    });
  }

  // Health Check System
  setInterval(() => {
    const now = Date.now();
    workerStates.forEach((state, pid) => {
      // Case 1: Worker is unresponsive (no heartbeat for 10s)
      if (now - state.lastHeartbeat > 10000) {
        console.error(`Worker ${pid} unresponsive - killing...`);
        const worker = Object.values(cluster.workers!).find(w => w?.process.pid === pid);
        worker?.kill();
      }
      // Case 2: Worker is overloaded (load > threshold for 30s)
      else if (state.load > 100 && now - state.lastHeartbeat > 30000) {
        console.error(`Worker ${pid} overloaded - restarting...`);
        cluster.workers![pid]?.kill();
      }
    });
  }, 5000); // Check every 5 seconds

  // Worker lifecycle management
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal})`);
    workerStates.delete(worker.process.pid!);
    
    // Auto-restart with backoff
    setTimeout(() => forkWorker(), 1000);
  });

  // Redis message handling
  subClient.subscribe('chunk_requests');
  subClient.on('message', async (channel, message) => {
    if (channel === 'chunk_requests') {
      const request = JSON.parse(message);
      const [pid] = [...workerStates.entries()]
        .filter(([_, state]) => state.isResponsive)
        .sort((a, b) => a[1].load - b[1].load)[0] || [];

      if (pid) {
        await pubClient.publish(`worker_${pid}`, JSON.stringify(request));
        workerStates.get(pid)!.load += 1;
      }
    }
  });

} else {
  // Worker process
  require('./OptimizedServer');

  // Worker heartbeat system
  setInterval(() => {
    process.send?.({ type: 'heartbeat' });
  }, 3000); // Send every 3 seconds
}