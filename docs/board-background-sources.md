# Background sources on the visual board

Select a picture or cutout, then tap **Background**. The composer offers:

- **Saved images**: pictures in the current owner's shared media library.
- **This board**: other picture tiles and inline visual tiles on the open board.
- **Image lookup**: the existing Pexels, Pixabay and Openverse media broker. Search, review candidates and credits, then choose **Use image**. Sources without connections are reported as unavailable.
- **Custom HTML / SVG**: paste self-contained artwork, set its dimensions, and choose **Use artwork**. **Try trippy rings** fills the editor with a code-generated example.
- **Upload image**: import a PNG, JPEG or WebP while keeping the composer open.

Position the cutout over the chosen background, select output proportions, then download PNG or save to the library and board. The originals remain available. Saved compositions link to both parent assets and carry attribution; credits also appear below the preview.

This composer exports **stills**. HTML/SVG is decoded as an inert SVG image: scripts, interactive controls, canvas drawings, video and SVG animation elements are removed. External resources are not captured. Embed raster pictures as PNG/JPEG/WebP data URLs. Use the existing Inline visual tile to run interactive or animated code; a timeline, puppet rig and video export are separate work.

The owner-authenticated Lab endpoint exposes `background_search` and idempotent `background_import`. Imports accept provider photo IDs, not arbitrary URLs, and retain broker download limits and host checks. No image model or GPU is invoked.
