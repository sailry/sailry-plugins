---
name: imagegen
description: Generate raster images such as photos, illustrations, textures and visual assets with the media package's image generation tool. Do not use for SVG icons, deterministic diagrams or visuals better expressed in project code.
---

# Image generation

Use the available `generate_image` tool from this package. The execution Node selects the admitted session model or its explicit media override and saves the real PNG result; this skill does not supply a model, credentials or tool permissions.

1. Turn the user's request into a clear prompt covering purpose, subject, style, composition and important constraints. Preserve requested text, colors and reference details. Make reasonable assumptions without adding unnecessary questions.
2. Generate the image with the tool. Never replace a requested raster image with SVG, a canvas drawing or a placeholder. If generation is unavailable, explain the limitation and the needed media configuration rather than claiming success.
3. Inspect the returned image with an available image viewing tool when needed to judge the requested result. Refine one specific issue at a time if another generation is warranted; do not repeat a request whose provider outcome is uncertain.
4. Keep final images at their returned worktree-relative paths and present them with Markdown image syntax. Temporary files and discarded intermediates are not deliverables. Do not invent paths or print base64 content.

The generation tool currently creates new images from text. Do not claim image editing or reference-image input unless the available tool explicitly supports it. For an existing SVG/icon system or a code-native diagram, preserve that format and use the ordinary file tools instead.

## Prompt shaping

For a detailed request, organize the existing requirements without adding creative requirements. For a broad request, add only useful framing, lighting, material or intended-use details. Do not invent brands, slogans, extra subjects or layout constraints. For complex images, use short labeled sections: purpose, scene, subject, style, composition, exact text and constraints.

Quote requested in-image text verbatim and state any placement or typography requirements. Describe concrete visible details instead of generic quality slogans. Check the returned subject, composition, text and exclusions; when refining, preserve the original constraints and change one issue at a time.
