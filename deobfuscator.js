import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

const traverse = traverseModule.default || traverseModule;
const generate = generateModule.default || generateModule;

let arrayName = null;
let arrayElements = [];

// --- PASS 1: DICTIONARY EXTRACTION ---
function extractDictionary(ast) {
    traverse(ast, {
        VariableDeclarator(path) {
            if (path.node.init?.type === 'ArrayExpression' && path.node.init.elements.length > 50) {
                let tempElements = [];
                const elementsPaths = path.get('init.elements');
                for (let elPath of elementsPaths) {
                    if (!elPath.node) { tempElements.push(undefined); continue; }
                    const evaluated = elPath.evaluate();
                    if (evaluated.confident) tempElements.push(evaluated.value);
                    else return;
                }
                arrayName = path.node.id.name;
                arrayElements = tempElements;
                path.stop();
            }
        }
    });
}

// --- PASS 2: CONSTANT FOLDING ---
function foldASTLayer(ast) {
    let changed = false;
    traverse(ast, {
        MemberExpression(path) {
            if (path.node.object.name === arrayName && path.node.computed && t.isNumericLiteral(path.node.property)) {
                const val = arrayElements[path.node.property.value];
                path.replaceWith(t.valueToNode(val === undefined ? undefined : val));
                changed = true;
            }
        },
        "BinaryExpression|LogicalExpression|UnaryExpression"(path) {
            try {
                const evaluated = path.evaluate();
                if (evaluated.confident && evaluated.value !== undefined) {
                    path.replaceWith(t.valueToNode(evaluated.value));
                    changed = true;
                }
            } catch (e) {}
        }
    });
    return changed;
}

// --- PASS 3: VIRTUAL MACHINE STRING RESOLUTION ---
function resolveStringsVM(ast) {
    let changedCount = 0;
    // 1. Grab all global functions and variables (the decoders)
    const setupNodes = ast.program.body.filter(n => t.isFunctionDeclaration(n) || t.isVariableDeclaration(n));
    const { code: setupCode } = generate(t.program(setupNodes), { compact: true });

    // 2. Create the Sandbox
    let vm;
    try {
        vm = new Function(`
            ${setupCode};
            return function(fn, arg) { 
                try { return eval(fn)(arg); } catch(e) { return null; } 
            };
        `)();
    } catch (e) { return 0; }

    // 3. Replace calls like mRmaj76(100)
    traverse(ast, {
        CallExpression(path) {
            if (t.isIdentifier(path.node.callee) && path.node.arguments.length === 1 && t.isNumericLiteral(path.node.arguments[0])) {
                const result = vm(path.node.callee.name, path.node.arguments[0].value);
                if (typeof result === 'string') {
                    path.replaceWith(t.stringLiteral(result));
                    changedCount++;
                }
            }
        }
    });
    return changedCount;
}

document.getElementById('btn')?.addEventListener('click', async () => {
    const input = document.getElementById('input').value.trim();
    const output = document.getElementById('output');
    const progressBar = document.getElementById('progressBar');
    if (!input) return;

    output.value = "Initializing AST Pipeline...";
    progressBar.style.display = "block";
    progressBar.value = 5;

    const yieldToBrowser = () => new Promise(r => setTimeout(r, 10));

    try {
        const shellAst = parse(input, { sourceType: 'script', allowReturnOutsideFunction: true });
        let extractedPayload = null;
        traverse(shellAst, {
            CallExpression(path) {
                if (path.node.callee.name === 'Function' && path.node.arguments.length > 0) {
                    const lastArg = path.node.arguments[path.node.arguments.length - 1];
                    if (t.isStringLiteral(lastArg)) { extractedPayload = lastArg.value; path.stop(); }
                }
            }
        });

        if (!extractedPayload) throw new Error("Payload extraction failed.");

        const innerAst = parse(extractedPayload, { sourceType: 'script', allowReturnOutsideFunction: true });
        extractDictionary(innerAst);
        
        // Loop folding until stable
        for (let i = 0; i < 10; i++) {
            progressBar.value = 20 + (i * 5);
            output.value = `Folding Layer ${i+1}...`;
            await yieldToBrowser();
            if (!foldASTLayer(innerAst)) break;
        }

        output.value = "Running String Decoder VM...";
        progressBar.value = 80;
        await yieldToBrowser();
        const resolved = resolveStringsVM(innerAst);

        output.value = `Resolved ${resolved} strings. Finalizing...`;
        const { code: finalCode } = generate(innerAst, { retainLines: false, compact: false });

        progressBar.value = 100;
        output.value = `--- DEOBFUSCATION COMPLETE ---\n\n` + finalCode;

    } catch (err) {
        output.value = "ERROR: " + err.message;
    }
});
