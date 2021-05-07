export class PromiseQueue {
    tasks: (() => Promise<any>)[] = [];

    addTask(task: () => Promise<any>) {
        this.tasks.push(task);
        if (this.tasks.length === 1) {
            this.handleTask();
        }
    }
    async handleTask() {
        if (this.tasks.length > 0) {
            this.tasks[0]().finally(() => {
                this.tasks.shift();
                this.handleTask();
            });
        }
    }
}