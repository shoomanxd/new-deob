import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM packaging quirks
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

let arrayName = null;
let arrayElements = [];

// Pass 1: Find the Dictionary Array safely
function extractDictionary(ast) {
    traverse(ast, {
        VariableDeclarator(path) {
            // Look for an array with more than 50 elements
            if (
                path.node.id.type === 'Identifier' &&
                path.node.init &&
                path.node.init.type === 'ArrayExpression' &&
                path.node.init.elements.length > 50
            ) {
                let allLiterals = true;
                let tempElements = [];

                const elementsPaths = path.get('init.elements');
                for (let elPath of elementsPaths) {
                    if (!elPath.node) {
                        tempElements.push(undefined);
                        continue;
                    }

                    // Manually handle 'void 0' which sometimes confuses Babel
                    if (elPath.isUnaryExpression({ operator: 'void' })) {
                        tempElements.push(undefined);
                        continue;
                    }

                    // Let Babel compute weird obfuscator tricks like !0x1 or !0x0
                    const evaluated = elPath.evaluate();
                    if (evaluated.confident) {
                        tempElements.push(evaluated.value);
                    } else {
                        allLiterals = false;
                        break;
                    }
                }

                if (allLiterals) {
                    arrayName = path.node.id.name;
                    arrayElements = tempElements;
                    console.log(`Dictionary Found: ${arrayName} with ${arrayElements.length} items.`);
                    path.stop(); 
                }
            }
        }
    });
}

// Pass 2: Fold a single layer of math and array lookups
function foldASTLayer(ast) {
    let changed = false;
    traverse(ast, {
        // Find Pj3JEg3[15] and replace with actual value
        MemberExpression(path) {
            if (path.node.object.name === arrayName && path.node.computed) {
                const prop = path.node.property;
                if (prop.type === 'NumericLiteral') {
                    const val = arrayElements[prop.value];
                    if (val !== undefined) {
                        if (val === null) {
                            path.replaceWith(t.nullLiteral());
                        } else if (typeof val === 'number') {
                            // AST requires negative numbers to be built specifically
                            if (val < 0) path.replaceWith(t.unaryExpression('-', t.numericLiteral(Math.abs(val))));
                            else path.replaceWith(t.numericLiteral(val));
                        } else if (typeof val === 'string') {
                            path.replaceWith(t.stringLiteral(val));
                        } else if (typeof val === 'boolean') {
                            path.replaceWith(t.booleanLiteral(val));
                        }
                        changed = true;
                    } else {
                        // It is actually undefined
                        path.replaceWith(t.identifier('undefined'));
                        changed = true;
                    }
                }
            }
        },
        // Calculate garbage math
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    const val = evaluated.value;
                    if (val === null) {
                        path.replaceWith(t.nullLiteral());
                        changed = true;
                    } else if (typeof val === 'number') { 
                        // Fix for Babel crashing on negative numbers
                        if (val < 0) path.replaceWith(t.unaryExpression('-', t.numericLiteral(Math.abs(val))));
                        else path.replaceWith(t.numericLiteral(val)); 
                        changed = true; 
                    } else if (typeof val === 'string') { 
                        path.replaceWith(t.stringLiteral(val)); 
                        changed = true; 
                    } else if (typeof val === 'boolean') { 
                        path.replaceWith(t.booleanLiteral(val)); 
                        changed = true; 
                    }
                }
            } catch (e) {
                // Safely ignore math that can't be resolved yet
            }
        }
    });
    return changed;
}

// MAIN EXECUTION
document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    const progressBar = document.getElementById('progressBar');
    
    if (!input) return;

    // Reset UI
    output.value = "Starting Custom AST Pipeline...";
    if (progressBar) {
        progressBar.style.display = "block";
        progressBar.value = 0;
    }

    // Force browser to render UI before locking CPU
    const yieldToBrowser = () => new Promise(r => setTimeout(r, 10));

    try {
        await yieldToBrowser();
        
        // 1. Extract shell payload (allowReturnOutsideFunction fixes the 1:32396 error)
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

        if (!extractedPayload) throw new Error("Function payload not found. Make sure you pasted the raw original code.");

        if (progressBar) progressBar.value = 10;
        output.value = "Payload found. Parsing inner AST...";
        await yieldToBrowser();

        // 2. Parse inner AST and extract the dictionary
        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });
        
        extractDictionary(innerAst);
        
        if (!arrayName) {
            throw new Error("Dictionary array not found! The extraction logic missed it.");
        }

        // 3. Chunked Execution Loop (Clean up the math)
        const maxIterations = 30; // Increased to 30 just in case
        let keepFolding = true;
        
        for (let i = 0; i < maxIterations; i++) {
            if (!keepFolding) break;
            
            if (progressBar) progressBar.value = 10 + Math.floor((i / maxIterations) * 80);
            output.value = `Running AST Pass ${i + 1} of ${maxIterations}...\nReplacing ${arrayName} lookups and folding math.`;
            await yieldToBrowser();

            keepFolding = foldASTLayer(innerAst);
        }

        if (progressBar) progressBar.value = 95;
        output.value = "Generating final code...";
        await yieldToBrowser();

        // 4. Generate the simplified code
        const { code: cleanedInnerCode } = generate(innerAst, { 
            retainLines: false, 
            compact: false, 
            comments: false 
        });

        if (progressBar) progressBar.value = 100;
        output.value = "--- AST DICTIONARY REPLACEMENT DONE ---\n\n" + cleanedInnerCode;

    } catch (err) {
        console.error(err);
        output.value = "ERROR:\n" + (err.message || err.stack);
        if (progressBar) progressBar.classList.add("progress-error");
    }
});
