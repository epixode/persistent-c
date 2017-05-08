
import {writeValue} from './memory';
import {builtinTypes, pointerType, arrayType} from './type';
import {IntegralValue, PointerValue, ArrayValue, FunctionValue, BuiltinValue, zeroAtType} from './value';
import {findClosestBlockScope, findClosestFunctionScope} from './scope';

export default {
  /* These effects only mutate 'core'. */
  doControl,
  doResult,
  doLoad,
  doStore,
  doEnter,
  doLeave,
  doCall,
  doReturn,
  doVardecl,
  /* The 'declare' effects also mutate these elements of 'core':
     globalMap, recordDecls, functions
  */
  declareGlobalVar,
  declareRecord,
  declareFunction
};

function doControl (core, control) {
  core.control = control;
  core.direction = 'down';
  core.result = undefined;
};

function doResult (core, result) {
  core.direction = 'up';
  core.result = result;
};

function doLoad (core, ref) {
  core.memoryLog = core.memoryLog.push(['load', ref]);
};

function doStore (core, ref, value) {
  core.memory = writeValue(core.memory, ref, value);
  core.memoryLog = core.memoryLog.push(['store', ref, value]);
};

function doEnter (core, blockNode) {
  const parentScope = core.scope;
  core.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: parentScope.limit,
    kind: 'block',
    blockNode
  }
};

function doLeave (core, blockNode) {
  const scope = findClosestBlockScope(core.scope, blockNode);
  if (!scope) {
    console.log('stack underflow', core.scope, blockNode);
    throw new Error('stack underflow');
  }
  core.scope = scope.parent;
};

function doCall (core, cont, values) {
  /* values is [func, args...] */
  const parentScope = core.scope;
  core.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: parentScope.limit,
    kind: 'function',
    cont,
    values
  };
};

function doReturn (core, result) {
  const scope = findClosestFunctionScope(core.scope);
  if (!scope) {
    console.log('stack underflow', core.scope, result);
    throw new Error('stack underflow');
  }
  // Pop all scopes up to and including the function's scope.
  core.scope = scope.parent;
  // Transfer control to the caller's continuation…
  core.control = scope.cont;
  // passing the return value to the caller (handling the special case for
  // control leaving the 'main' function without a return statement, where
  // C99 defines the result as being 0).
  if (!result && scope.cont.values[0].name === 'main') {
    core.result = new IntegralValue(builtinTypes['int'], 0);
  } else {
    core.result = result;
  }
  // Set direction to 'out' to indicate that a function was exited.
  core.direction = 'out';
};

function doVardecl (core, name, type, init) {
  const parentScope = core.scope;
  const refType = pointerType(type);
  let limit = parentScope.limit;
  let ref, doInit = !!init;
  if (doInit) {
    if (type.kind === 'array' && init.type.kind === 'pointer') {
      // When an array variable is initialized with a ref (as opposed to an
      // array value), no stack allocation or initialization occurs.
      ref = new PointerValue(refType, init.address);
      doInit = false;
    }
  }
  if (!ref) {
    // Allocate memory on stack and build a ref to that location.
    limit -= type.size;
    ref = new PointerValue(refType, limit);
  }
  core.scope = {
    parent: parentScope,
    key: parentScope.key + 1,
    limit: limit,
    kind: 'variable',
    name, type, ref
  };
  if (doInit) {
    doStore(core, ref, init);
  }
};

function declareGlobalVar (core, name, type, init) {
  const address = core.heapStart;
  core.heapStart += type.size;  // XXX add alignment padding
  const ref = new PointerValue(pointerType(type), address);
  core.memory = writeValue(core.memory, ref, init);
  core.globalMap[name] = ref;
};

function declareRecord (core, name, type) {
  core.recordDecls[name] = type;
};

/* XXX check if decl can be omitted, it is only used because directives are
   lifted from the function body-block into the fundecl node "to allow
   directives to inspect arguments". */
function declareFunction (core, name, type, body, decl) {
  const codePtr = core.functions.length;
  let value;
  if (body) {
    value = new FunctionValue(type, codePtr, name, body, decl);
  } else {
    value = new BuiltinValue(type, codePtr, name);
  }
  core.functions.push(value);
  core.globalMap[name] = value;
};
