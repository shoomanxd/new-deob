import { webcrack } from 'webcrack';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM quirks with Babel
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

// Helper to force the CPU to pause so the UI can receive the log messages
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function foldConstants(ast) {
    traverse(ast, {
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    path.replaceWith(t.valueToNode(evaluated.value));
                }
            } catch (e) {
                // Safely ignore math errors
            }
        }
    });
}

// Listen for messages from the UI
self.onmessage = async function(event) {
    const { input } = event.data;

    try {
        self.postMessage({ status: '1. Parsing outer shell AST...' });
        await sleep(100); // Yield to event loop to print log

        const shellAst = parse(input, { sourceType: 'script', allowReturnOutsideFunction: true });
        
        let extractedPayload = null;

        traverse(shellAst, {
            CallExpression(path) {
                if (path.node.callee.name === 'Function') {
                    const args = path.node.arguments;
                    if (args.length > 0 && args[args.length - 1].type === 'StringLiteral') {
                        extractedPayload = args[args.length - 1].value;
                        path.stop(); 
                    }
                }
            }
        });

        if (!extractedPayload) {
            throw new Error("Could not find the Function string payload.");
        }

        self.postMessage({ status: '2. Payload found! Cleaning garbage math...' });
        await sleep(100);

        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });

        // Safely fold the constants once to simplify the math
        foldConstants(innerAst);

        self.postMessage({ status: '3. Handing off to Webcrack for unminification...' });
        await sleep(100);

        const { code: cleanedInnerCode } = generate(innerAst, { retainLines: false, compact: false, comments: false });

        // CRITICAL FIX: Disable webcrack's deobfuscator, only use the unminifier.
        const result = await webcrack(cleanedInnerCode, {
            unminify: true,
            deobfuscate: false, // <--- This was causing the infinite freeze
            jsx: false,
            unpack: false
        });

        // Send the final result back to the UI
        self.postMessage({ success: true, code: result.code });

    } catch (error) {
        self.postMessage({ success: false, error: error.message || error.toString() });
    }
};
