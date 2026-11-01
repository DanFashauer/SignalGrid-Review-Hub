// Simple assertion helper - throws TypeError if condition is falsy
const invariant = (condition, message) => {
  if (!condition) {
    throw new TypeError(`${message}: received ${JSON.stringify(condition)}`);
  }
};

export default invariant;
