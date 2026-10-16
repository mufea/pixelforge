import { DomainError } from "@/lib/errors";
import type { ImageLimits } from "@/lib/assets/validate-image";

export type CropBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ImageTransform = {
  crop?: CropBox;
  width?: number;
  height?: number;
};

export function assertCropBox(crop: CropBox, imageWidth: number, imageHeight: number) {
  if (
    !Number.isInteger(crop.left) ||
    !Number.isInteger(crop.top) ||
    !Number.isInteger(crop.width) ||
    !Number.isInteger(crop.height)
  ) {
    throw new DomainError("VALIDATION_CROP", "Crop values must be integers");
  }
  if (crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1) {
    throw new DomainError("VALIDATION_CROP", "Crop box must be inside the image");
  }
  if (crop.left + crop.width > imageWidth || crop.top + crop.height > imageHeight) {
    throw new DomainError("VALIDATION_CROP", "Crop box must be inside the image");
  }
}

export function plannedOutputSize(
  sourceWidth: number,
  sourceHeight: number,
  transform: ImageTransform = {},
) {
  let width = sourceWidth;
  let height = sourceHeight;
  if (transform.crop) {
    assertCropBox(transform.crop, sourceWidth, sourceHeight);
    width = transform.crop.width;
    height = transform.crop.height;
  }
  if (transform.width && transform.height) {
    width = transform.width;
    height = transform.height;
  } else if (transform.width) {
    height = Math.max(1, Math.round((height * transform.width) / width));
    width = transform.width;
  } else if (transform.height) {
    width = Math.max(1, Math.round((width * transform.height) / height));
    height = transform.height;
  }
  return { width, height };
}

export function assertResizeWithinLimits(
  width: number,
  height: number,
  limits: ImageLimits,
) {
  if (width < 1 || height < 1) {
    throw new DomainError("VALIDATION_RESIZE", "Output dimensions must be at least 1×1");
  }
  if (width > limits.maxImageEdgePx || height > limits.maxImageEdgePx) {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image edge exceeds the allowed maximum");
  }
  if (width * height > limits.maxImagePixels) {
    throw new DomainError("VALIDATION_IMAGE_TOO_LARGE", "The image pixel count exceeds the allowed maximum");
  }
}
