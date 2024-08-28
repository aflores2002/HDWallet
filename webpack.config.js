const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {

        devtool: 'inline-source-map', // or 'cheap-source-map'

        entry: {
                popup: './src/popup.js',
                background: './src/background.js',
                contentScript: './src/contentScript.js'
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
                        {
                                test: /\.m?js/,
                                resolve: {
                                        fullySpecified: false
                                }
                        }
                ]
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
                                { from: 'src/bitcoinProvider.js', to: '.' }
                        ],
                }),
                new webpack.ProvidePlugin({
                        process: 'process/browser',
                        Buffer: ['buffer', 'Buffer'],
                }),
                new webpack.DefinePlugin({
                        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
                }),
                new webpack.NormalModuleReplacementPlugin(
                        /node:crypto/,
                        require.resolve('crypto-browserify')
                ),
                new webpack.IgnorePlugin({
                        resourceRegExp: /^\.\/locale$/,
                        contextRegExp: /moment$/,
                }),
        ],
        resolve: {
                fallback: {
                        "crypto": require.resolve("crypto-browserify"),
                        "stream": require.resolve("stream-browserify"),
                        "buffer": require.resolve("buffer/"),
                        "util": require.resolve("util/"),
                        "process": require.resolve("process/browser"),

                        "vm": require.resolve("vm-browserify")
                },
                alias: {
                        process: "process/browser"
                }
        },
        experiments: {
                asyncWebAssembly: true,
        },
};