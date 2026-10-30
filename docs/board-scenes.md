# Editable scenes on the visual board

Open **Add → Layered scene**, **Compose scene** on a picture/cutout, or **Edit scene** on a saved scene tile. The two-image Background composer remains available.

A scene is an editable board item, not a flattened replacement picture. Save it with **Save editable scene**. Its stable layer IDs, names, image references, groups, masks, pivots and motions survive reload. PNG exports create additional media; originals remain in the library.

## Building and puppeting a scene

- Add images from the library, current board, stock lookup, uploads or captured HTML/SVG artwork. **Cut out layer** reuses the existing cutout editor and replaces only the scene's image reference.
- Add shapes, text, groups and placement zones. Select a named colored layer, drag it, resize its lower-right corner, or edit position, size, rotation, opacity, ordering, visibility and lock settings. Coordinates are in scene pixels relative to the parent group.
- A group transforms its children. A wing or hand can rotate around its own pivot while its parent travels. Set the pivot with sliders or a canvas tap.
- The layer color is an editing identifier; it is not part of the exported image.
- A painted mask hides/reveals the selected piece's pixels in its local coordinates. Start from whole-piece-visible or whole-piece-hidden and paint Reveal/Hide strokes. Small is the initial brush size. Undo/redo includes painting.
- A placement zone is a named rectangle or ellipse. **Keep inside zone** clips a piece to that zone in world coordinates, even while the piece, zone or their parents move. Zones only appear as editing guides. They are not collision physics or automatic scenery understanding.
- Any piece or group can sway, bob, travel, pulse, flap/wave, or stretch vertically as a simple mouth-opening effect. Period, phase and strength separate motions. The mouth effect is not audio-synchronized lip animation and does not invent hidden anatomy.
- **Park starter** adds clearly stylized code-drawn scenery, swaying tree groups and a traveling bird with separately flapping wings. Add real scenery through Image lookup for photographic compositions.
- Soft shadows and Normal/Multiply/Screen blends help integrate individual pieces.

Use Play/Pause and the time scrubber to preview. Edits return to the start pose. Download the current frame as PNG, save it to the board, or download a self-contained animated HTML scene. The HTML includes static layer artwork, masks, transform data and working transport controls; no external assets or provider calls are needed. Video/MP4 rendering, audio timing, automatic part extraction, skeletal mesh deformation and arbitrary keyframes are not implemented here.

Limits: 24 layers, 30 seconds, 4 megapixels (each dimension 40–2048 whole pixels), 80 strokes per mask, 2,400 total mask points, 65 KB scene JSON and the existing 110 KB board cap. Previews and decoded pictures are bounded; offscreen board scenes pause and release their renderer. Keep the editable scene: exported PNG provenance has the first eight image parents (existing media contract) and an explicit input-count/truncation note. The saved scene retains every input reference.

## Interactive tools and a later Mermaid board

A saved scene has **Add scene controls**. This adds a real linked inline tool tile. Select that tile and enable **Interact** to play/pause/scrub its target scene. The host verifies the sending iframe's exact window, currently interactive tile ID and stored target ID. Only bounded transport commands cross this bridge. An ordinary inline visual, parent-window message or mismatched target cannot operate a scene. Offscreen playback is paused.

This is the narrow starting point for future tool tiles and Mermaid workflow nodes. Mermaid diagrams are not installed or executed by this PR.

The open editor exposes a local window.nexusScene handle:

- scene, selected, targetId: current snapshots/identity.
- select(layerId), command(command): validated data operations.
- play(), pause(), seek(seconds): local transport.

Command data uses stable layer IDs. Supported operations: add, patch, remove, reorder, duplicate, mask_stroke, settings. Patches cannot introduce executable code; the scene contract validates layer types, masks, motion enums, bounds, group cycles and zone references.

For an authenticated same-origin owner workflow, POST /api/nexus-lab:

    {
      "action": "board_scene_edit",
      "input": {
        "id": "board-id",
        "item_id": "scene-item-id",
        "base_rev": 7,
        "commands": [
          {"op": "patch", "id": "bird-wing-id", "patch": {
            "motion": {"kind": "flap", "amount": 25, "period": 0.8}
          }}
        ]
      }
    }

Read the board first; include its exact revision. Up to 20 commands apply together; an invalid command saves nothing. Board writes compare the stored snapshot atomically through the existing Neon Lua adapter. A stale or concurrent writer gets 409 and must reload; do not blindly retry mutations. This endpoint is not a new public API key or MCP tool and is not reachable directly from sandboxed inline HTML. Future workflow bridges must explicitly expose their intended commands and use the existing authenticated services.
