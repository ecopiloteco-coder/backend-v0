const supa = require('../utils/supabase');

describe('Supabase utils', () => {
  test('signedUploadUrlToPublicUrl converts upload/sign to public', () => {
    const input = 'https://example.supabase.co/storage/v1/object/upload/sign/upload/pending-articles/a.png?token=abc';
    const out = supa.signedUploadUrlToPublicUrl(input);
    expect(out).toContain('/storage/v1/object/public/upload/pending-articles/a.png');
  });

  test('extractBucketAndPathFromPublicUrl parses bucket and path', () => {
    const input = 'https://example.supabase.co/storage/v1/object/public/upload/articles/file.pdf';
    const parsed = supa.extractBucketAndPathFromPublicUrl(input);
    expect(parsed).toEqual({ bucket: 'upload', path: 'articles/file.pdf' });
  });
});


