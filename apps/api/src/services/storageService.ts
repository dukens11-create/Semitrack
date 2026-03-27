import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";

const s3 = new S3Client({
  region: env.awsRegion,
  credentials: {
    accessKeyId: env.awsAccessKeyId,
    secretAccessKey: env.awsSecretAccessKey,
  },
});

export async function uploadDocument(
  fileName: string,
  mimeType: string,
  buffer: Buffer
) {
  const key = `documents/${Date.now()}-${fileName}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: env.s3Bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return {
    fileName,
    fileUrl: `https://${env.s3Bucket}.s3.${env.awsRegion}.amazonaws.com/${key}`,
    key,
  };
}
