// Screen resolution
const SCREEN_WIDTH = 1080;
const SCREEN_HEIGHT = 2400;
// Assumed raw touchscreen range (adjust if known, e.g., from driver specs)
const RAW_MAX = 4095;
// Replay interval in milliseconds
const REPLAY_INTERVAL = 10; // Adjust for replay speed
const EVENT_DEVICE = '/dev/input/event3'; // Replace with actual event device if different

// Regular expressions (pre-compiled)
const X_REGEX = /EV_ABS\s+ABS_MT_POSITION_X\s+([0-9a-f]{8})$/;
const Y_REGEX = /EV_ABS\s+ABS_MT_POSITION_Y\s+([0-9a-f]{8})$/;
const TOUCH_DOWN_REGEX = /EV_KEY\s+BTN_TOUCH\s+DOWN/;
const TOUCH_UP_REGEX = /EV_KEY\s+BTN_TOUCH\s+UP/;

// Function to scale raw coordinates to screen coordinates
function scaleCoordinates(rawX, rawY) {
    const scaledX = Math.round(rawX * SCREEN_WIDTH / RAW_MAX);
    const scaledY = Math.round(rawY * SCREEN_HEIGHT / RAW_MAX);
    return [scaledX, scaledY];
}

// Function to perform a single tap (adb command)
function performTap(x, y) {
    Bun.spawn(['adb', 'shell', `input tap ${x} ${y}`], {
        stdio: ['inherit', 'inherit', 'inherit'],
    });
}

// Main monitoring function
async function monitorAndReplay() {
    const getEvent = Bun.spawn(['adb', 'shell', 'getevent', '-l', EVENT_DEVICE], {
        stdout: 'pipe',
        stderr: 'pipe',
    });

    let touchActive = false;
    let lastX = null;
    let lastY = null;
    let replayIntervalId = null;

    const reader = getEvent.stdout.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log('getevent process ended.');
                break;
            }

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                console.log('Raw getevent line:', trimmedLine); // Debugging line

                let match;
                if ((match = trimmedLine.match(X_REGEX))) {
                    lastX = parseInt(match[1], 16);
                    console.log('X coordinate:', lastX);
                } else if ((match = trimmedLine.match(Y_REGEX))) {
                    lastY = parseInt(match[1], 16);
                    console.log('Y coordinate:', lastY);
                } else if (trimmedLine.match(TOUCH_DOWN_REGEX)) {
                    touchActive = true;

                    // Set the interval here
                    replayIntervalId = setInterval(() => {
                        if (lastX !== null && lastY !== null) {
                            const [scaledX, scaledY] = scaleCoordinates(lastX, lastY);
                            performTap(scaledX, scaledY);
                        }
                    }, REPLAY_INTERVAL);

                } else if (trimmedLine.match(TOUCH_UP_REGEX) && touchActive) {
                    touchActive = false;
                    if (replayIntervalId) {
                        clearInterval(replayIntervalId);
                        replayIntervalId = null;
                        console.log('Touch up, replay stopped.');
                    }
                    lastX = null;
                    lastY = null;
                }
            }
        }
    } catch (error) {
        console.error('Error during monitoring:', error);
    }

    const stderrReader = getEvent.stderr.getReader();
    const stderrChunk = await stderrReader.read();
    if (!stderrChunk.done) {
        console.error(`Error: ${decoder.decode(stderrChunk.value)}`);
    }

    const exitCode = await getEvent.exited;
    console.log(`getevent process exited with code ${exitCode}`);
}

process.on('SIGINT', () => {
    console.log('\nStopped by user.');
    process.exit();
});

console.log('Starting live touch hold and release replay script...');
monitorAndReplay();