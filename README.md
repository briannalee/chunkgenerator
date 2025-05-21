# Project Setup Instructions

This project includes both a client and a server. Follow the instructions below to set up and run the project.

## Prerequisites

- Node.js
- MongoDB

### 1. Install MongoDB

If you don't have MongoDB installed, you can install it by following the [official MongoDB installation guide](https://docs.mongodb.com/manual/installation/).

Alternatively, you can use Docker to run MongoDB:

```bash
docker run --name mongodb -d -p 27017:27017 mongo
```

### 2. Set Up the Server
#### Install Dependencies
Navigate to the server directory and install the required packages:
```bash
cd server
npm install
```

#### Create `.env` file
Create a `.env` file to configure the servers connection to MongoDB:
```dotenv
MONGO_URI=mongodb://localhost:27017/terrain_game
PORT=8080
```

#### Start the Server
Start the server with the following command:
```bash
npm run start
```

### 3. Set Up the Client
#### Install Dependencies
Navigate to the client directory and install the required packages:
```bash
cd client
npm install
```

#### Create `.env` file
```dotenv
WS_PORT=8080                              
SERVER=localhost 
WS_PROTOCOL=ws                        
```

#### Run the Client
Start the client with the following command:
```bash
npm run dev
```

### 4. Access the Application
Open the client in a web browser using the default port `http://localhost:5173/`.