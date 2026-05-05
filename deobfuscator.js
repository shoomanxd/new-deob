// The "?worker" tag is Vite magic. It automatically bundles the file as a Web Worker!
import DeobfuscatorWorker from './worker.js?worker';

document.getElementById('btn')?.addEventListener('click', () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) {
        output.value = "Please paste some code first.";
        return;
    }

    output.value = "Starting background worker... Browser will NOT freeze.";

    // 1. Create the background worker
    const worker = new DeobfuscatorWorker();

    // 2. Send the input code to the worker
    worker.postMessage({ input });

    // 3. Listen for updates and the final result from the worker
    worker.onmessage = (event) => {
        const data = event.data;

        // If it's just a status update, show it
        if (data.status) {
            output.value += `\n${data.status}`;
        } 
        // If it's the final success result
        else if (data.success) {
            output.value = data.code;
            worker.terminate(); // Kill the worker to free up memory
        } 
        // If it crashed
        else if (data.success === false) {
            output.value += `\n\nERROR:\n${data.error}`;
            worker.terminate();
        }
    };

    // If the worker completely crashes
    worker.onerror = (err) => {
        output.value += `\n\nFATAL WORKER ERROR:\n${err.message}`;
        worker.terminate();
    };
});
