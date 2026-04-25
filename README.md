# Phone Speaker Remix

Browser app for making music clips translate better on iPhone and Android speakers before posting to TikTok, Instagram Reels, YouTube Shorts, or other social platforms.

It runs entirely on the client side with raw JavaScript and the Web Audio API. Audio files stay local in the browser.

## How To Run

Open `index.html` directly in a browser, or serve the folder with any static server.

Example:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173/
```

## How To Use

1. Upload an audio file.
2. Select the clip range with the sliders or by dragging on the waveform.
3. Pick a preset:
   - `Balanced`: general phone speaker master.
   - `Tiny`: stronger cleanup for very small speakers.
   - `Bass`: more virtual bass harmonics.
   - `Voice`: keeps vocals and speech clearer.
4. Adjust tone and loudness if needed.
5. Click `Remix clip`.
6. Preview original vs remixed.
7. Download WAV, or MP3 if the browser supports native MP3 recording.

## Example Before / After

These links should play in the browser when viewed on GitHub:

- [Before: original bass-heavy clip](https://raw.githubusercontent.com/elft/phone-speaker-remix/main/before.mp3)
- [After: phone-speaker remix](https://raw.githubusercontent.com/elft/phone-speaker-remix/main/after.mp3)

The before clip is the `0:09` to `0:41` section from `Skull_Crush.mp3`. The after clip is the same section after running it through the phone-speaker remix pipeline.

## How It Works

Phones do not reproduce deep sub-bass well, so the app does not simply boost bass. Instead it:

- cuts unusable sub-bass,
- detects bass-heavy or muddy sections,
- adds upper bass harmonics that small speakers can reproduce,
- reduces stereo width for better mono compatibility,
- boosts presence so vocals and lead elements stay clear,
- compresses and limits the clip for social playback.

`Smart preserve` keeps clean sections closer to the original and applies stronger processing only where the detector finds heavy bass, mud, or peak pressure.
