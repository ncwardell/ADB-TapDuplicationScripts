// Screen resolution
const SCREEN_WIDTH = 1080;
const SCREEN_HEIGHT = 2400;
// Assumed raw touchscreen range (adjust if known, e.g., from driver specs)
const RAW_MAX = 4095;
// Number of times to replay each detected touch
const REPLAY_COUNT = 20;
// Debounce time in milliseconds
const DEBOUNCE_TIME = REPLAY_COUNT * 2;

// Regular expressions (pre-compiled)
const X_REGEX = /ABS_MT_POSITION_X.*([0-9a-f]{8})$/;
const Y_REGEX = /ABS_MT_POSITION_Y.*([0-9a-f]{8})$/;
const TOUCH_DOWN_REGEX = /BTN_TOUCH\s+DOWN/;
const TOUCH_UP_REGEX = /BTN_TOUCH\s+UP/;

// Function to scale raw coordinates to screen coordinates
function scaleCoordinates(rawX, rawY) {
    const scaledX = Math.round(rawX * SCREEN_WIDTH / RAW_MAX);
    const scaledY = Math.round(rawY * SCREEN_HEIGHT / RAW_MAX);
    return [scaledX, scaledY];
}

// Function to replay a tap multiple times (batched adb commands)
function replayTap(x, y, count) {
    let adbCommands = '';
    for (let i = 0; i < count; i++) {
        adbCommands += `input tap ${x} ${y}; `;
    }
    Bun.spawn(['adb', 'shell', adbCommands], {
        stdio: ['inherit', 'inherit', 'inherit'],
    });
    console.log(`Replayed tap ${count} times at (${x}, ${y})`);
}

// Main monitoring function
async function monitorAndReplay() {
    const getEvent = Bun.spawn(['adb', 'shell', 'getevent', '-l', '/dev/input/event3'], {
        stdout: 'pipe',
        stderr: 'pipe',
    });

    let touchActive = false;
    let lastX = null;
    let lastY = null;
    let lastReplayTime = 0;

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

                let match;
                if ((match = trimmedLine.match(X_REGEX))) {
                    lastX = parseInt(match[1], 16);
                } else if ((match = trimmedLine.match(Y_REGEX))) {
                    lastY = parseInt(match[1], 16);
                } else if (trimmedLine.match(TOUCH_DOWN_REGEX)) {
                    touchActive = true;
                } else if (trimmedLine.match(TOUCH_UP_REGEX) && touchActive) {
                    touchActive = false;
                    if (lastX !== null && lastY !== null) {
                        const currentTime = Date.now();
                        if (currentTime - lastReplayTime > DEBOUNCE_TIME) {
                            const [scaledX, scaledY] = scaleCoordinates(lastX, lastY);
                            console.log(
                                `Detected touch at raw (${lastX}, ${lastY}) -> scaled (${scaledX}, ${scaledY})`
                            );
                            replayTap(scaledX, scaledY, REPLAY_COUNT);
                            lastReplayTime = currentTime;
                        }
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

console.log('Starting live touch replay script...');
monitorAndReplay();