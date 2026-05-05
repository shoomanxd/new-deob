import { webcrack } from 'webcrack';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM quirks with Babel
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

/**
 * Custom AST Pass 1: Constant Folding
 * This evaluates all the garbage math and string concatenations.
 * E.g., `1 + 2` becomes `3`. `["a", "b"].join("")` becomes `"ab"`.
 */
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
            } catch (e) {
                // Ignore evaluation errors
            }
        },
        MemberExpression(path) {
            // Evaluates static array access like Pj3JEg3[0] if the array is known
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    // Prevent replacing necessary object properties with undefined
                    if (typeof evaluated.value !== 'function') {
                        path.replaceWith(t.valueToNode(evaluated.value));
                        changed = true;
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
    });
    return changed;
}

export async function processPayload(obfuscatedCode) {
    try {
        let extractedPayload = null;

        // Step 1: Parse the outer shell
        const shellAst = parse(obfuscatedCode, { sourceType: 'script' });

        // Step 2: Extract the Function(...) payload
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
            throw new Error("Could not find the dynamic Function string payload.");
        }

        // Step 3: Parse the extracted inner payload into a new AST
        const innerAst = parse(extractedPayload, { sourceType: 'script' });

        // Step 4: Apply our Custom AST Passes (Loop until no more constants can be folded)
        let keepFolding = true;
        let iterations = 0;
        while (keepFolding && iterations < 5) { // Cap at 5 to prevent infinite loops
            keepFolding = foldConstants(innerAst);
            iterations++;
        }

        // Step 5: Generate the cleaned inner code
        const { code: cleanedInnerCode } = generate(innerAst, {
            retainLines: false,
            compact: false,
            comments: false
        });

        // Step 6: Pass our custom-cleaned code into Webcrack to finish the job
        const result = await webcrack(cleanedInnerCode, {
            unminify: true,
            deobfuscate: true,
            jsx: false,
            unpack: false
        });

        return result.code;

    } catch (error) {
        console.error(error);
        return `Error during custom deobfuscation: \n${error.message}`;
    }
}

// Attach to the UI
document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) {
        output.value = "Please paste some code first.";
        return;
    }

    output.value = "Running Custom AST Passes & Webcrack... Please wait.";
    const cleanCode = await processPayload(input);
    output.value = cleanCode;
});
