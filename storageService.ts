import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
});

export async function uploadDocument(fileName: string, mimeType: string, buffer: Buffer) {
  const bucket = process.env.S3_BUCKET ?? "";
  const key = `documents/${Date.now()}-${fileName}`;

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  }));

  return {
    fileName,
    key,
    fileUrl: `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
  };
}
