import os
import re
from io import BytesIO
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from werkzeug.datastructures import FileStorage
from app.db import execute


MAX_IMAGE_SIZE = 50 * 1024

_IMAGE_SIGNATURES = (
    (b'\x89PNG\r\n\x1a\n', '.png'),
    (b'\xff\xd8\xff', '.jpg'),
)


def _image_extension(header):
    for signature, extension in _IMAGE_SIGNATURES:
        if header.startswith(signature):
            return extension
    if len(header) >= 12 and header[:4] == b'RIFF' and header[8:12] == b'WEBP':
        return '.webp'
    raise ValueError('Unsupported image file. Choose a PNG, JPG, JPEG, or WebP image.')


def save_product_image(upload: FileStorage, upload_dir: str) -> str:
    content = upload.stream.read(MAX_IMAGE_SIZE + 1)
    if len(content) >= MAX_IMAGE_SIZE:
        raise ValueError('Image files must be smaller than 50 KB.')
    extension = _image_extension(content[:16])
    try:
        with Image.open(BytesIO(content)) as image:
            expected_format = {'.png': 'PNG', '.jpg': 'JPEG', '.webp': 'WEBP'}[extension]
            if image.format != expected_format:
                raise ValueError('The uploaded file is not a valid PNG, JPG, or WebP image.')
            image.verify()
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as exc:
        raise ValueError('The uploaded file is not a valid PNG, JPG, or WebP image.') from exc
    os.makedirs(upload_dir, exist_ok=True)
    filename = f'{uuid4().hex}{extension}'
    path = os.path.join(upload_dir, filename)
    with open(path, 'xb') as image_file:
        image_file.write(content)
    return f'/uploads/product-images/{filename}'


def remove_unreferenced_image(db, image: str, upload_dir: str) -> None:
    match = re.fullmatch(r'/uploads/product-images/([0-9a-f]{32}\.(?:png|jpg|webp))', image or '')
    if not match:
        return
    if execute(db, 'SELECT 1 FROM products WHERE image = ? LIMIT 1', (image,)).fetchone():
        return
    if execute(db, 'SELECT 1 FROM order_items WHERE product_image_snapshot = ? LIMIT 1', (image,)).fetchone():
        return
    if execute(db, 'SELECT 1 FROM deal_campaigns WHERE image = ? LIMIT 1', (image,)).fetchone():
        return
    path = os.path.join(upload_dir, match.group(1))
    if os.path.isfile(path):
        os.remove(path)
