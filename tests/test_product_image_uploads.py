from io import BytesIO
from uuid import uuid4

from PIL import Image

from app import create_app
from app.auth import hash_password
from app.db import execute


def _image_bytes(image_format):
    image = Image.new('RGB', (4, 4), color=(30, 80, 120))
    data = BytesIO()
    image.save(data, format=image_format)
    return data.getvalue()


def _manager_client(app):
    suffix = uuid4().hex
    email = f'image-upload-{suffix}@example.test'
    with app.app_context():
        db = app.get_db()
        cursor = execute(
            db,
            'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ('Image Upload Test', email, hash_password('ImageUploadTest123!'), 'manager'),
        )
        user_id = cursor.lastrowid
        if hasattr(db, 'commit'):
            db.commit()
    client = app.test_client()
    login = client.post('/api/auth/login', json={
        'email': email,
        'password': 'ImageUploadTest123!',
    })
    assert login.status_code == 200
    return client, {'Authorization': f"Bearer {login.get_json()['token']}"}, user_id


def test_product_image_uploads_and_existing_image_behavior(tmp_path):
    app = create_app()
    app.config['PRODUCT_IMAGE_UPLOAD_DIR'] = str(tmp_path)
    client, headers, user_id = _manager_client(app)
    product_ids = []
    try:
        url_product = client.post('/api/products', headers=headers, json={
            'name': 'URL image product',
            'category': 'Bakery',
            'price': 100,
            'image': 'https://example.test/product.png',
        })
        assert url_product.status_code == 201
        assert url_product.get_json()['product']['image'] == 'https://example.test/product.png'
        product_ids.append(url_product.get_json()['product']['id'])

        no_image_product = client.post('/api/products', headers=headers, json={
            'name': 'No image product',
            'category': 'Bakery',
            'price': 100,
        })
        assert no_image_product.status_code == 201
        assert no_image_product.get_json()['product']['image'] is None
        product_ids.append(no_image_product.get_json()['product']['id'])

        preserved = client.put(
            f"/api/products/{product_ids[0]}",
            headers=headers,
            json={'name': 'URL image product edited', 'price': 110},
        )
        assert preserved.status_code == 200
        assert preserved.get_json()['product']['image'] == 'https://example.test/product.png'

        for image_format, extension, content_type in (
            ('PNG', 'png', 'image/png'),
            ('JPEG', 'jpg', 'image/jpeg'),
            ('WEBP', 'webp', 'image/webp'),
        ):
            response = client.post(
                '/api/products',
                headers=headers,
                data={
                    'name': f'{image_format} upload product',
                    'category': 'Bakery',
                    'price': '100',
                    'image': 'https://example.test/ignored-url.png',
                    'image_file': (BytesIO(_image_bytes(image_format)), f'client-name.{extension}', content_type),
                },
                content_type='multipart/form-data',
            )
            assert response.status_code == 201
            product = response.get_json()['product']
            product_ids.append(product['id'])
            assert product['image'].startswith('/uploads/product-images/')
            assert product['image'].endswith(f'.{extension}')
            file_response = client.get(product['image'])
            assert file_response.status_code == 200
            assert file_response.mimetype == content_type
            assert file_response.data == _image_bytes(image_format)

            if image_format == 'PNG':
                replaced = client.put(
                    f"/api/products/{product_ids[0]}",
                    headers=headers,
                    data={
                        'name': 'URL image product edited',
                        'category': 'Bakery',
                        'price': '110',
                        'image': 'https://example.test/also-ignored.png',
                        'image_file': (BytesIO(_image_bytes('PNG')), 'replacement.png', 'image/png'),
                    },
                    content_type='multipart/form-data',
                )
                assert replaced.status_code == 200
                new_image = replaced.get_json()['product']['image']
                assert new_image.startswith('/uploads/product-images/')
                assert new_image != product['image']

                restarted_app = create_app()
                restarted_app.config['PRODUCT_IMAGE_UPLOAD_DIR'] = str(tmp_path)
                persisted = restarted_app.test_client().get(new_image)
                assert persisted.status_code == 200
                assert persisted.data == _image_bytes('PNG')

        exact_limit_image = _image_bytes('PNG')
        exact_limit_image += b'\0' * (50 * 1024 - len(exact_limit_image))
        exact_limit = client.post(
            '/api/products',
            headers=headers,
            data={
                'name': 'Exact limit image product',
                'category': 'Bakery',
                'price': '100',
                'image_file': (BytesIO(exact_limit_image), 'exact.png', 'image/png'),
            },
            content_type='multipart/form-data',
        )
        assert exact_limit.status_code == 400
        assert 'smaller than 50 KB' in exact_limit.get_json()['error']

        invalid_type = client.post(
            '/api/products',
            headers=headers,
            data={
                'name': 'Invalid image product',
                'category': 'Bakery',
                'price': '100',
                'image_file': (BytesIO(b'<script>alert(1)</script>'), 'bad.png', 'image/png'),
            },
            content_type='multipart/form-data',
        )
        assert invalid_type.status_code == 400
        assert 'PNG, JPG' in invalid_type.get_json()['error']

        oversized = client.post(
            '/api/products',
            headers=headers,
            data={
                'name': 'Oversized image product',
                'category': 'Bakery',
                'price': '100',
                'image_file': (BytesIO(b'\x89PNG\r\n\x1a\n' + b'x' * (50 * 1024)), 'large.png', 'image/png'),
            },
            content_type='multipart/form-data',
        )
        assert oversized.status_code == 400
        assert 'smaller than 50 KB' in oversized.get_json()['error']

        unauthorized = client.post('/api/products', json={
            'name': 'Unauthenticated upload',
            'category': 'Bakery',
            'price': 100,
        })
        assert unauthorized.status_code == 403
    finally:
        with app.app_context():
            db = app.get_db()
            for product_id in product_ids:
                execute(db, 'DELETE FROM products WHERE id = ?', (product_id,))
            execute(db, 'DELETE FROM users WHERE id = ?', (user_id,))
            if hasattr(db, 'commit'):
                db.commit()
