const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ATTACHMENTS = 3;
const MAX_IMAGE_BYTES = 750_000;
const MAX_TOTAL_BYTES = 2_000_000;

function cleanName(value, index) {
  return String(value || `image-${index + 1}`)
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, 120) || `image-${index + 1}`;
}

function hasExpectedSignature(mediaType, bytes) {
  if (mediaType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mediaType === 'image/png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function parseRoomAttachments(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error('Images must be sent as a list');
  if (input.length > MAX_ATTACHMENTS) throw new Error(`Attach no more than ${MAX_ATTACHMENTS} images at once`);

  let totalBytes = 0;
  return input.map((item, index) => {
    const mediaType = String(item?.mediaType || '');
    const base64 = String(item?.data || item?.base64 || '').replace(/\s/gu, '');
    if (!ALLOWED_MEDIA_TYPES.has(mediaType) || !/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) {
      throw new Error('Use a JPG, PNG, or WebP image');
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error('Each image must be under 750 KB after compression');
    }
    if (!hasExpectedSignature(mediaType, bytes)) throw new Error('The uploaded file does not match its image type');
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('The attached images are too large together');
    return {
      name: cleanName(item?.name, index),
      mediaType,
      base64,
      token: `NEXUS_IMAGE_${index + 1}`,
    };
  });
}

export function attachmentManifest(attachments) {
  if (!attachments.length) return '(none)';
  return attachments.map((item) => `${item.token}: ${item.name} (${item.mediaType})`).join('\n');
}

export function attachmentMessageContent(text, attachments) {
  if (!attachments.length) return text;
  return [
    { type: 'text', text },
    ...attachments.map((item) => ({
      type: 'image',
      source: { type: 'base64', media_type: item.mediaType, data: item.base64 },
    })),
  ];
}

export function embedRoomAttachments(html, attachments) {
  return attachments.reduce((output, item) => {
    const dataUrl = `data:${item.mediaType};base64,${item.base64}`;
    return output.split(item.token).join(dataUrl);
  }, String(html || ''));
}

export const ROOM_ATTACHMENT_LIMITS = Object.freeze({
  maxAttachments: MAX_ATTACHMENTS,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
});
