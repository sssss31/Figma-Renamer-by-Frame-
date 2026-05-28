/**
 * webpack.config.js — Smart Frame Exporter
 *
 * Two completely separate bundles:
 *   - `code`  → dist/code.js   (runs in Figma's main-thread sandbox; no DOM)
 *   - `ui`    → dist/ui.html   (runs in the iframe; React + JSZip + DOM)
 *
 * Figma loads the UI from the single compile-time string `__html__`, so the UI
 * JS MUST be inlined into ui.html. HtmlInlineScriptPlugin does exactly that,
 * producing one self-contained file (no external <script src> that the
 * sandboxed iframe could never resolve → no blank screen).
 */
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');
const path = require('path');

module.exports = (_env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    devtool: false, // inline source maps bloat the HTML / trip the iframe CSP

    entry: {
      ui: './src/ui/index.tsx',
      code: './src/plugin/code.ts',
    },

    module: {
      rules: [
        { test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
      ],
    },

    resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js'] },

    output: {
      filename: '[name].js',
      path: path.resolve(__dirname, 'dist'),
      clean: true,
    },

    target: ['web', 'es2017'],

    plugins: [
      new HtmlWebpackPlugin({
        template: './src/ui/index.html',
        filename: 'ui.html',
        chunks: ['ui'],
        inject: 'body',
        hash: false,
        minify: isProd,
      }),
      // Replace the external <script src="ui.js"> with the JS inlined as
      // <script>…</script>, leaving a fully self-contained dist/ui.html.
      new HtmlInlineScriptPlugin({ scriptMatchPattern: [/ui\.js$/] }),
      // NB: package is `html-inline-script-webpack-plugin` (webpack-5 compatible).
    ],

    performance: { hints: false },

    optimization: {
      splitChunks: false, // keep the ui bundle as one inlinable file
      runtimeChunk: false,
    },
  };
};
