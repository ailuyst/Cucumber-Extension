module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: ['dist/step_definitions/**/*.js'],
    format: ['progress']
  }
};
