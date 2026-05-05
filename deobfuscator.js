import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM quirks with Babel
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

/**
 * CUSTOM JSCONFUSER DEOBFUSCATION PIPELINE
 */
function customDeobfuscate(ast) {
    let arrayName = null;
    let arrayElements = [];

    // Step 1: Find the massive dictionary array (e.g., Pj3JEg3)
    traverse(ast, {
        VariableDeclarator(path) {
            if (
                path.node.id.type === 'Identifier' &&
                path.node.init &&
                path.node.init.type === 'ArrayExpression' &&
                path.node.init.elements.length > 50 // Look for a suspiciously large array
            ) {
                let allLiterals = true;
                let tempElements = [];

                // Extract all elements safely
                for (let el of path.node.init.elements) {
                    if (el === null) {
                        tempElements.push(null);
                    } else if (el.type === 'NumericLiteral' || el.type === 'StringLiteral' || el.type === 'BooleanLiteral') {
                        tempElements.push(el.value);
                    } else if (el.type === 'UnaryExpression' && el.operator === 'void') {
                        tempElements.push(undefined);
                    } else {
                        allLiterals = false;
                        break;
                    }
                }

                // If we successfully mapped it, save it into memory
                if (allLiterals) {
                    arrayName = path.node.id.name;
                    arrayElements = tempElements;
                    console.log("Dictionary Array Found:", arrayName);
                    path.stop(); 
                }
            }
        }
    });

    if (!arrayName) {
        console.warn("Could not locate the dictionary array. Obfuscation pattern might have changed.");
        return;
    }

    // Step 2: Loop through the AST, replacing array lookups and evaluating math
    let keepFolding = true;
    let iterations = 0;
    
    while (keepFolding && iterations < 20) { // Cap at 20 iterations to prevent infinite loops
        keepFolding = false;
        iterations++;

        traverse(ast, {
            // Replace `Pj3JEg3[25]` with its actual value
            MemberExpression(path) {
                if (path.node.object.name === arrayName && path.node.computed) {
                    const prop = path.node.property;
                    if (prop.type === 'NumericLiteral') {
                        const val = arrayElements[prop.value];
                        
                        if (val !== undefined) {
                            if (val === null) {
                                path.replaceWith(t.nullLiteral());
                            } else if (typeof val === 'number') {
                                path.replaceWith(t.numericLiteral(val));
                            } else if (typeof val === 'string') {
                                path.replaceWith(t.stringLiteral(val));
                            } else if (typeof val === 'boolean') {
                                path.replaceWith(t.booleanLiteral(val));
                            }
                            keepFolding = true;
                        } else {
                            // Handle undefined explicitly
                            path.replaceWith(t.identifier('undefined'));
                            keepFolding = true;
                        }
                    }
                }
            },
            // Fold math operations like `1 + 2` -> `3`
            "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
                try {
                    const evaluated = path.evaluate();
                    if (evaluated.confident && evaluated.value !== undefined) {
                        const val = evaluated.value;
                        if (typeof val === 'number') {
                            path.replaceWith(t.numericLiteral(val));
                            keepFolding = true;
                        } else if (typeof val === 'string') {
                            path.replaceWith(t.stringLiteral(val));
                            keepFolding = true;
                        } else if (typeof val === 'boolean') {
                            path.replaceWith(t.booleanLiteral(val));
                            keepFolding = true;
                        }
                    }
                } catch (e) {
                    // Ignore math errors caused by unresolved variables
                }
            }
        });
    }
}

document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) {
        output.value = "Please paste some code first.";
        return;
    }

    output.value = "Freezing browser to crunch the AST via Custom Pipeline...\nSee you in a few seconds.";
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // 1. Parse outer shell
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

        // 2. Parse the extracted inner payload
        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });

        // 3. Run our custom JSConfuser un-packer
        customDeobfuscate(innerAst);

        // 4. Generate the simplified code
        const { code: cleanedInnerCode } = generate(innerAst, { 
            retainLines: false, 
            compact: false, 
            comments: false 
        });

        output.value = "--- AST DICTIONARY REPLACEMENT DONE ---\n\n" + cleanedInnerCode;

    } catch (err) {
        console.error(err);
        output.value = "ERROR:\n" + (err.message || err.toString());
    }
});
