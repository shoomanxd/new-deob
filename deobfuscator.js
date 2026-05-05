import DeobfuscatorWorker from './worker.js?worker';

document.getElementById('btn')?.addEventListener('click', () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) return;

    output.value = "Starting background worker...";

    // 1. Create the background worker
    const worker = new DeobfuscatorWorker();

    // 2. Send the input code to the worker
    worker.postMessage({ input });

    // 3. Listen for live updates and the final result
    worker.onmessage = (event) => {
        const data = event.data;

        if (data.status) {
            output.value += `\n${data.status}`;
        } 
        else if (data.success) {
            output.value += `\n\n--- DONE ---\n\n${data.code}`;
            worker.terminate(); // Kill worker to free memory
        } 
        else if (data.success === false) {
            output.value += `\n\nERROR:\n${data.error}`;
            worker.terminate();
        }
    };

    worker.onerror = (err) => {
        output.value += `\n\nFATAL WORKER ERROR:\n${err.message}`;
        worker.terminate();
    };
});
