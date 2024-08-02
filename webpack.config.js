const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
        entry: {
                popup: './src/popup.js',
                background: './src/background.js'
        },
        output: {
                path: path.resolve(__dirname, 'dist'),
                filename: '[name].js',
        },
        module: {
                rules: [
                        {
                                test: /\.js$/,
                                exclude: /node_modules/,
                                use: {
                                        loader: 'babel-loader',
                                        options: {
                                                presets: ['@babel/preset-env', '@babel/preset-react']
                                        }
                                }
                        },
                        {
                                test: /\.css$/,
                                use: ['style-loader', 'css-loader'],
                        },
                ],
        },
        plugins: [
                new CleanWebpackPlugin(),
                new HtmlWebpackPlugin({
                        template: './src/popup.html',
                        filename: 'popup.html',
                        chunks: ['popup']
                }),
                new CopyWebpackPlugin({
                        patterns: [
                                { from: 'src/manifest.json', to: '.' },
                        ],
                }),
                new webpack.ProvidePlugin({
                        process: 'process/browser',
                        Buffer: ['buffer', 'Buffer'],
                }),
                new webpack.DefinePlugin({
                        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
                }),
                // new webpack.NormalModuleReplacementPlugin(/node:/, (resource) => {
                //         const mod = resource.request.replace(/^node:/, "");
                //         switch (mod) {
                //                 case "buffer":
                //                         resource.request = "buffer";
                //                         break;
                //                 case "stream":
                //                         resource.request = "readable-stream";
                //                         break;
                //                 default:
                //                         throw new Error(`Not found ${mod}`);
                //         }
                // }),
        ],
        resolve: {
                fallback: {
                        "crypto": require.resolve("crypto-browserify"),
                        "stream": require.resolve("stream-browserify"),
                        "buffer": require.resolve("buffer/"),
                        "util": require.resolve("util/"),
                        "process": require.resolve("process/browser")
                },
                alias: {
                        process: "process/browser"
                }
        },
        experiments: {
                asyncWebAssembly: true,
        },
};