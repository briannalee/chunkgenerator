// Priority Queue implementation for A*
export class PriorityQueue<T> {

    private elements: T[];
    private compare: (a: T, b: T) => boolean;

    constructor(compare: (a: T, b: T) => boolean) {
        this.elements = [];
        this.compare = compare;
    }

    enqueue(element: T): void {
        this.elements.push(element);
        this.elements.sort((a, b) => this.compare(a, b) ? -1 : 1);
    }

    dequeue(): T {
        return this.elements.shift()!;
    }

    isEmpty(): boolean {
        return this.elements.length === 0;
    }

    contains(element: Partial<T>, equals: (a: T, b: Partial<T>) => boolean): boolean {
        return this.elements.some(e => equals(e, element));
    }
}