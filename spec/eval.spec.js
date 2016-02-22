import test from 'tape';
import {start, run} from '..';

test("calling main", function (assert) {
  const state = run(start({decls: [
    ['FunctionDecl', {define: true, main: true}, [
      ['Name', {identifier: 'main'}, []],
      ['FunctionNoPrototype', {}, [
        ['BuiltinType', {name: 'int'}, []]
      ]],
      ['CompoundStmt', {}, [
        ['ReturnStmt', {}, [
          ['IntegerLiteral', {value: '0'}, []]
        ]]
      ]]
    ]]
  ]}));
  const {result} = state;
  assert.equal(result[0], 'integer', "return value is integer");
  assert.equal(result[1], 0, "return value is 0");
  assert.end();
});
