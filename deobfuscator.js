import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

let arrayName = null;
let arrayElements = [];

// Pass 1: Find the Dictionary
// Pass 1: Find the Dictionary (Upgraded)
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

                // Use Babel's built-in evaluator instead of checking manually
                const elementsPaths = path.get('init.elements');
                for (let elPath of elementsPaths) {
                    if (!elPath.node) {
                        tempElements.push(undefined);
                        continue;
                    }
                    
                    const evaluated = elPath.evaluate();
                    if (evaluated.confident) {
                        tempElements.push(evaluated.value);
                    } else {
                        // If Babel can't figure out the value, this isn't our static dictionary
                        allLiterals = false;
                        break;
                    }
                }

                if (allLiterals) {
                    arrayName = path.node.id.name;
                    arrayElements = tempElements;
                    console.log("Dictionary Array Found:", arrayName);
                    path.stop(); 
                }
            }
        }
    });
}


// Pass 2: Fold a single layer
function foldASTLayer(ast) {
    let changed = false;
    traverse(ast, {
        MemberExpression(path) {
            if (path.node.object.name === arrayName && path.node.computed) {
                const prop = path.node.property;
                if (prop.type === 'NumericLiteral') {
                    const val = arrayElements[prop.value];
                    if (val !== undefined) {
                        if (val === null) path.replaceWith(t.nullLiteral());
                        else if (typeof val === 'number') path.replaceWith(t.numericLiteral(val));
                        else if (typeof val === 'string') path.replaceWith(t.stringLiteral(val));
                        else if (typeof val === 'boolean') path.replaceWith(t.booleanLiteral(val));
                        changed = true;
                    } else {
                        path.replaceWith(t.identifier('undefined'));
                        changed = true;
                    }
                }
            }
        },
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    const val = evaluated.value;
                    if (typeof val === 'number') { path.replaceWith(t.numericLiteral(val)); changed = true; }
                    else if (typeof val === 'string') { path.replaceWith(t.stringLiteral(val)); changed = true; }
                    else if (typeof val === 'boolean') { path.replaceWith(t.booleanLiteral(val)); changed = true; }
                }
            } catch (e) {}
        }
    });
    return changed;
}

document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    const progressBar = document.getElementById('progressBar');
    
    if (!input) return;

    // Reset UI
    output.value = "Starting AST Pipeline...";
    progressBar.style.display = "block";
    progressBar.value = 0;

    // Helper to yield to the browser render thread
    const yieldToBrowser = () => new Promise(r => setTimeout(r, 0));

    try {
        await yieldToBrowser();
        
        // 1. Extract shell payload
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

        if (!extractedPayload) throw new Error("Function payload not found.");

        progressBar.value = 10;
        output.value = "Payload found. Parsing inner AST...";
        await yieldToBrowser();

        // 2. Parse inner AST and find dictionary
        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });
        extractDictionary(innerAst);
        
        if (!arrayName) throw new Error("Dictionary array not found.");

        // 3. Chunked Execution Loop
        const maxIterations = 20;
        let keepFolding = true;
        
        for (let i = 0; i < maxIterations; i++) {
            if (!keepFolding) break;
            
            // Calculate progress (10% to 90%)
            const progress = 10 + Math.floor((i / maxIterations) * 80);
            progressBar.value = progress;
            output.value = `Running AST Pass ${i + 1} of ${maxIterations}...`;
            
            // Yield so the progress bar actually visually updates
            await yieldToBrowser();

            keepFolding = foldASTLayer(innerAst);
        }

        progressBar.value = 95;
        output.value = "Generating final code...";
        await yieldToBrowser();

        // 4. Generate the simplified code
        const { code: cleanedInnerCode } = generate(innerAst, { 
            retainLines: false, 
            compact: false, 
            comments: false 
        });

        progressBar.value = 100;
        output.value = "--- AST DICTIONARY REPLACEMENT DONE ---\n\n" + cleanedInnerCode;

    } catch (err) {
        console.error(err);
        output.value = "ERROR:\n" + (err.message || err.toString());
        progressBar.classList.add("progress-error");
    }
});
