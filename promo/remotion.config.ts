import {Config} from '@remotion/cli/config';

// WebGL2 needs ANGLE backend to render in headless Chrome.
// Default 'swiftshader' silently drops the canvas content.
Config.setChromiumOpenGlRenderer('angle');

// Higher quality output
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
