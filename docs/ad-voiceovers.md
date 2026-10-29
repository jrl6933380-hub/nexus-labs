# Ad voiceovers

Open an ad from Ads, then choose **Add voiceover**. This opens the ad viewer at its voiceover controls.

1. Choose the ElevenLabs MP3 (or WAV, M4A or OGG) from the device file picker. Files up to 8 MB are supported.
2. Wait for the upload to finish. Play the attached recording to check it.
3. Choose **Export with voiceover**. It queues a 24 fps, scale-2 final MP4 through the existing render worker. You can leave and return to the page while it renders.
4. Choose **Load finished video**, check playback, then **Download video**. Devices supporting file sharing also show **Share / save video**.

The audio attachment is scoped to the signed-in account and campaign, separate from the creative project. Replacing it does not rewrite the ad. Speech starts at zero; the existing encoder trims long audio to the ad duration. This feature does not align words or retime scenes automatically. Check the finished export before posting.

`POST /api/ad-voiceover` uses the existing session resolver, same-site request checks, stable request IDs for writes, the media store's chunk checksums and actual-file-type validation, and the existing render queue. Its JSON body limit accepts a 384 KiB chunk encoded as base64. Downloaded audio/video is checked against the stored size and SHA-256 before playback/download links appear. Video files remain subject to the render job store's retention; exporting again regenerates an expired file. The Ads feed retains the finished render through the existing media persistence worker.

## Verification

- `node --test test/ad-voiceover.test.mjs test/ad-campaigns.test.mjs test/ad-render-jobs.test.mjs test/ad-render-persist.test.mjs`
- `node scripts/verify-ad-voiceover.mjs` (requires Playwright Chromium and ffmpeg). On small test machines, `NEXUS_BROWSER_LOW_MEMORY=1` uses fewer browser processes.

The browser check uses the production HTTP handler and real stores with in-memory account data, a real multi-chunk WAV, and a real downloadable MP4. Worker completion is simulated; it verifies the queued audio ID, persistence across reloads, preview, and checksum-verified download at phone and desktop widths without touching production.
