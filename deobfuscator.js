import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

// Handle Vite's ESM packaging quirks
const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

/**
 * PASS 1: Dynamic Constant Folding
 * Hunts down massive constant arrays and garbage math, resolving them
 * down to their literal values.
 */
function foldConstants(ast) {
    let changed = false;
    const mappedArrays = {};

    // 1. Identify and memorize large constant arrays
    traverse(ast, {
        VariableDeclarator(path) {
            if (t.isIdentifier(path.node.id) && t.isArrayExpression(path.node.init)) {
                let allLiterals = true;
                let elements = [];
                for (let el of path.node.init.elements) {
                    if (!el) elements.push(undefined);
                    else if (t.isNumericLiteral(el) || t.isStringLiteral(el) || t.isBooleanLiteral(el)) elements.push(el.value);
                    else if (t.isNullLiteral(el)) elements.push(null);
                    else if (t.isUnaryExpression(el) && el.operator === 'void') elements.push(undefined);
                    else { allLiterals = false; break; }
                }
                // If it's a massive array of literals, map it to memory
                if (allLiterals && elements.length > 10) { 
                    mappedArrays[path.node.id.name] = elements;
                }
            }
        }
    });

    // 2. Replace array lookups and fold math
    traverse(ast, {
        MemberExpression(path) {
            if (t.isIdentifier(path.node.object) && path.node.computed && t.isNumericLiteral(path.node.property)) {
                const arrName = path.node.object.name;
                if (mappedArrays[arrName]) {
                    const val = mappedArrays[arrName][path.node.property.value];
                    if (val === null) path.replaceWith(t.nullLiteral());
                    else if (val === undefined) path.replaceWith(t.identifier('undefined'));
                    else path.replaceWith(t.valueToNode(val));
                    changed = true;
                }
            }
        },
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    const val = evaluated.value;
                    if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
                        path.replaceWith(t.valueToNode(val));
                        changed = true;
                    }
                }
            } catch (e) { /* Ignore unsolvable math */ }
        }
    });

    return changed;
}

/**
 * PASS 2: Virtual Machine String Resolver
 * Extracts decoders, creates a sandbox, and decodes hidden strings.
 */
function resolveStrings(ast) {
    let changed = false;
    let setupNodes = [];

    // 1. Isolate the setup environment (Decoders, Rotators, Arrays)
    // We grab all top-level functions and variables, skipping the main app logic loop
    traverse(ast, {
        Program(path) {
            for (const node of path.node.body) {
                if (t.isVariableDeclaration(node) || t.isFunctionDeclaration(node)) {
                    setupNodes.push(node);
                } else if (t.isExpressionStatement(node)) {
                    // Skip massive IIFEs (which is where the main app payload lives)
                    if (!(t.isCallExpression(node.expression) && t.isFunctionExpression(node.expression.callee))) {
                        setupNodes.push(node);
                    }
                }
            }
        }
    });

    const { code: setupCode } = generate(t.program(setupNodes), { compact: true });
    
    // 2. Build the Virtual Machine Sandbox
    let decodeSandbox;
    try {
        decodeSandbox = new Function(`
            try {
                // Inject the obfuscator's decoder functions into this scope
                ${setupCode};
                
                // Return a function that attempts to evaluate calls dynamically
                return function(fnName, arg) {
                    try {
                        if (typeof eval(fnName) === 'function') {
                            return eval(fnName + "(" + JSON.stringify(arg) + ")");
                        }
                    } catch(e) {}
                    return null;
                }
            } catch(e) {
                return function() { return null; }
            }
        `)();
    } catch (e) {
        console.warn("Sandbox compilation failed", e);
        return false;
    }

    // 3. Traverse the AST and pass calls to the Sandbox
    traverse(ast, {
        CallExpression(path) {
            const callee = path.node.callee;
            const args = path.node.arguments;

            // Look for decoder signatures: functionName(123) or functionName("abc")
            if (t.isIdentifier(callee) && args.length === 1 && (t.isNumericLiteral(args[0]) || t.isStringLiteral(args[0]))) {
                const funcName = callee.name;
                const argVal = args[0].value;

                // Ignore standard JavaScript functions
                if (['require', 'parseInt', 'String', 'Number'].includes(funcName)) return;

                // Send to Sandbox
                const decoded = decodeSandbox(funcName, argVal);
                
                if (typeof decoded === 'string') {
                    path.replaceWith(t.stringLiteral(decoded));
                    changed = true;
                }
            }
        }
    });

    return changed;
}

/**
 * MAIN EXECUTION
 */
document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    
    if (!input) {
        output.value = "Please paste some code first.";
        return;
    }

    output.value = "Executing AST Pipeline & Virtual Machine...\nBrowser will freeze for 10-30 seconds.";
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // Step 1: Extract the payload from the Function(...) wrapper
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

        if (!extractedPayload) throw new Error("Could not extract the Function payload.");

        // Step 2: Parse the inner obfuscated payload
        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });

        // Step 3: Run the Custom Pipeline (Loop until clean)
        let keepProcessing = true;
        let iterations = 0;
        
        while (keepProcessing && iterations < 15) {
            let folded = foldConstants(innerAst);
            let resolved = resolveStrings(innerAst);
            
            // Continue looping as long as either pass makes changes
            keepProcessing = folded || resolved;
            iterations++;
        }

        // Step 4: Output the deobfuscated code
        const { code: finalCode } = generate(innerAst, { 
            retainLines: false, 
            compact: false, 
            comments: false 
        });

        output.value = `--- CUSTOM PIPELINE FINISHED (Iterations: ${iterations}) ---\n\n` + finalCode;

    } catch (err) {
        console.error(err);
        output.value = "ERROR:\n" + (err.message || err.toString());
    }
});
