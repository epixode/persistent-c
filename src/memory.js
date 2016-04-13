
export const deref = function (state, ref, ty) {

  if (ref === undefined) {
    alert('dereferenced undefined pointer');
    return undefined;
  }

  // A reference to a builtin or a user function evaluates to itself.
  if (ref[0] === 'builtin' || ref[0] === 'function')
    return ref;

  if (ref[0] === 'pointer') {
    const address = ref[1];
    // XXX read at type ty
    let memory = state.memory;
    while (memory) {
      if (memory.address === address) {
        return memory.value;
      }
      memory = memory.parent;
    }
  }

  return 0;
};
