# Troubleshooting

## The browser does not ask for microphone access

Audio capture only works on `localhost` or over HTTPS. Open the app at `http://localhost:5173` on the laptop that runs it, not at the laptop's network address.

## "Audio input permission was denied"

Allow microphone access for the site in the browser (the lock icon next to the address bar), and also in the operating system:

- **macOS:** System Settings > Privacy & Security > Microphone, and enable your browser.
- **Windows:** Settings > Privacy & security > Microphone, and allow desktop apps to access it.

Then click **Connect audio input** again.

## "No audio input device was found" or "The audio input is unavailable or in use by another application"

Check that the interface or microphone is plugged in and is not exclusively used by another program (for example a DAW or a video call). Close the other program or select a different input.

## The level meter does not move

- Make sure the right input is selected in the **Audio input** drop-down.
- Check the input volume in the operating system's sound settings.
- When visualizing music played on the same computer, you need a loopback device. See [Audio source](user-guide.md#audio-source).

## The visuals barely react, or are always at maximum

The input level is too low or too high. Adjust the gain on the mixer, interface or system input volume until the meter moves across most of its range on loud parts without staying pinned.

## The visualizer opens full screen on the wrong display

Press **F** to leave full screen, drag the browser window onto the correct display and press **F** again. See [display setups](display-setups.md).

## "Audio input lost. Press S to choose another input."

The device was unplugged or stopped. Reconnect it, press **S**, choose the input and click **Start visualizer**.

## The picture is choppy

- Close other tabs and applications.
- Plug the laptop into mains power and disable battery saver.
- Run the external display at its native resolution.
- Use a browser with hardware acceleration enabled (Chrome and Edge have it on by default).
- Try a lighter visual such as **EQ Bars**.

## The screen goes dark or the screensaver starts

The app asks the browser to keep the screen awake while the stage is running. If it still happens, disable sleep and the screensaver in the operating system settings, and keep the laptop on mains power.

## The image on the LED wall or projector is cropped or stretched

The problem is in the display's scaling, not in the app. Set the display to its native resolution or the processor's input resolution, and configure the aspect ratio on the video processor or projector. See [Example 3](display-setups.md#example-3-laptop-to-an-led-wall).
