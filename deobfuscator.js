import { webcrack } from 'webcrack';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

// Babel's traverse export can be quirky in Vite, this handles it safely
const traverse = traverseModule.default || traverseModule;

document.getElementById('btn').addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) {
        output.value = "Please paste some code first.";
        return;
    }

    output.value = "1. Parsing AST to find hidden payload...";

    try {
        // Step 1: Parse the outer shell
        const ast = parse(input, { sourceType: 'script' });
        let extractedPayload = null;

        // Step 2: Traverse and find Function("...", "payload")
        traverse(ast, {
            CallExpression(path) {
                if (path.node.callee.name === 'Function') {
                    const args = path.node.arguments;
                    if (args.length > 0 && args[args.length - 1].type === 'StringLiteral') {
                        extractedPayload = args[args.length - 1].value;
                        path.stop(); // Found it, stop searching
                    }
                }
            }
        });

        if (!extractedPayload) {
            throw new Error("Could not find the Function string payload. Ensure the code includes the Function() wrapper.");
        }

        output.value = "2. Payload extracted. Running Webcrack engine...\n(This might take a few seconds)";

        // Step 3: Run webcrack on the raw extracted string
        const result = await webcrack(extractedPayload, {
            unminify: true,
            deobfuscate: true,
            jsx: false,
            unpack: false
        });

        // Step 4: Output the clean code
        output.value = result.code;

    } catch (err) {
        console.error(err);
        output.value = "Error during deobfuscation:\n" + err.message;
    }
});
