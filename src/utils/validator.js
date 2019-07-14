import validator from 'validator';

export function check(params, contraints) {
  const errors = [];

  Object.keys(contraints).forEach((param) => {
    let value = params[param] || '';
    value = value.toString();
    const paramContraints = contraints[param];

    Object.keys(paramContraints).forEach((contraint) => {
      if (typeof validator[contraint] !== 'function') {
        return;
      }
      const { errorMessage = '', options = {}, isTruthyError = false } = paramContraints[contraint];

      if (!isTruthyError && validator[contraint](value, options)) {
        return;
      }
      if (isTruthyError && !validator[contraint](value, options)) {
        return;
      }
      errors.push({
        param,
        message: errorMessage,
        value,
      });
    });
  });

  return (errors.length && errors) || null;
}
