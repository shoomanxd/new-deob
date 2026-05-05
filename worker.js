import { webcrack } from 'webcrack';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM quirks with Babel
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

function foldConstants(ast) {
    let changed = false;
    traverse(ast, {
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    path.replaceWith(t.valueToNode(evaluated.value));
                    changed = true;
                }
            } catch (e) {}
        },
        MemberExpression(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    if (typeof evaluated.value !== 'function') {
                        path.replaceWith(t.valueToNode(evaluated.value));
                        changed = true;
                    }
                }
            } catch (e) {}
        }
    });
    return changed;
}

// Listen for messages from the UI
self.onmessage = async function(event) {
    const { input } = event.data;

    try {
        self.postMessage({ status: '1. Parsing outer shell AST...' });
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

        self.postMessage({ status: '2. Folding constants (cleaning garbage math)...' });
        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });

        // Cap at 3 iterations to prevent infinite loops from locking the worker
        let keepFolding = true;
        let iterations = 0;
        while (keepFolding && iterations < 3) {
            keepFolding = foldConstants(innerAst);
            iterations++;
        }

        self.postMessage({ status: '3. Handing off to Webcrack...' });
        const { code: cleanedInnerCode } = generate(innerAst, { retainLines: false, compact: false, comments: false });

        const result = await webcrack(cleanedInnerCode, {
            unminify: true,
            deobfuscate: true,
            jsx: false,
            unpack: false
        });

        // Send the final result back to the UI
        self.postMessage({ success: true, code: result.code });

    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};
