import {Config} from '@remotion/cli/config';

// WebGL2 needs ANGLE backend to render in headless Chrome.
// Default 'swiftshader' silently drops the canvas content.
Config.setChromiumOpenGlRenderer('angle');

// Higher quality output
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);



/**
 * 1. 123
 * 2. 321
 * ![](https://cdn.pixabay.com/photo/2026/05/27/04/29/04-29-48-584_1280.jpg)
 */
