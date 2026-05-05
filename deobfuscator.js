import { webcrack } from 'webcrack';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM quirks with Babel
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

// Our custom math cleaner
function foldConstants(ast) {
    traverse(ast, {
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                // If Babel can calculate the math, replace the math with the final number
                if (evaluated.confident && evaluated.value !== undefined) {
                    path.replaceWith(t.valueToNode(evaluated.value));
                }
            } catch (e) {
                // Ignore math errors
            }
        }
    });
}

document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) {
        output.value = "Please paste some code first.";
        return;
    }

    // Tell the user what's happening
    output.value = "Freezing browser to crunch the AST...\nSee you in 10-30 seconds.";
    
    // CRITICAL: Give the browser 50 milliseconds to actually draw the text above 
    // onto the screen before we completely lock up the CPU thread.
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // 1. Parse outer shell (with the return fix!)
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

        if (!extractedPayload) throw new Error("Could not find the Function string payload.");

        // 2. Parse the extracted payload
        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });

        // 3. Fold the constants to clean up the garbage math
        foldConstants(innerAst);

        // 4. Generate the simplified code
        const { code: cleanedInnerCode } = generate(innerAst, { retainLines: false, compact: false, comments: false });

        // 5. Run Webcrack
        // CRITICAL FIX: deobfuscate is FALSE so it doesn't infinite loop and permanently freeze
        const result = await webcrack(cleanedInnerCode, {
            unminify: true,
            deobfuscate: false, 
            jsx: false,
            unpack: false
        });

        // 6. Print the final result!
        output.value = "--- DONE ---\n\n" + result.code;

    } catch (err) {
        console.error(err);
        output.value = "ERROR:\n" + (err.message || err.toString());
    }
});
