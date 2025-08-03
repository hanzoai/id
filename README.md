# Hanzo ID

Hanzo ID is a modern Identity and Access Management (ID) system based on Casdoor, customized for the Hanzo ecosystem. It provides comprehensive authentication and authorization services with support for OAuth 2.0, OIDC, SAML, CAS, LDAP, SCIM, WebAuthn, TOTP, MFA and RADIUS protocols.

## Features

- 🔐 **Multi-Protocol Support**: OAuth 2.0, OpenID Connect, SAML, CAS, LDAP, RADIUS
- 🛡️ **Advanced Security**: WebAuthn, TOTP, MFA, Passwordless authentication
- 🎨 **Customizable UI**: Modern, responsive interface with Hanzo branding
- 🌐 **Multi-Tenancy**: Support for multiple organizations and applications
- 🔄 **SSO Integration**: Seamless Single Sign-On across Hanzo services
- 📊 **Comprehensive Admin Panel**: User management, role-based access control, audit logs
- 🚀 **High Performance**: Built with Go for speed and reliability
- 🐳 **Cloud Native**: Docker-ready with Kubernetes support

## Quick Start

### Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/hanzoai/id.git hanzo-id
cd hanzo-id

# Start services
docker compose up -d

# Access Hanzo ID at http://localhost:8000
```

### Development Setup

```bash
# Backend
go mod download
go run main.go

# Frontend (in another terminal)
cd web
yarn install
yarn start
```

## Configuration

Edit `conf/app.conf` to configure:

- Database connection (MySQL/PostgreSQL)
- Redis connection
- OAuth providers
- SMTP settings
- And more...

## Environment Variables

- `MYSQL_ROOT_PASSWORD`: Database root password
- `REDIS_PASSWORD`: Redis password (if enabled)
- `HANZO_ID_SECRET`: Application secret key

## Default Credentials

- Username: `admin`
- Password: `123456`

⚠️ **Important**: Change the default password immediately after first login.

## API Documentation

Swagger documentation is available at: `http://localhost:8000/swagger/`

## Deployment

### Production with Traefik

```bash
docker compose -f compose.prod.yaml up -d
```

This will deploy Hanzo ID with:
- Automatic SSL/TLS via Let's Encrypt
- Traefik reverse proxy
- Production-ready MySQL and Redis
- Available at https://id.hanzo.ai

### Development Environment

```bash
docker compose -f compose.dev.yaml up -d
```

Available at https://id-dev.hanzo.ai

## Integration with Hanzo Services

Hanzo ID seamlessly integrates with:

- **Hanzo Chat**: AI-powered chat platform
- **Hanzo Cloud**: Infrastructure management
- **Hanzo Analytics**: Usage tracking and insights
- **Hanzo API**: Core API services

## Security

- All passwords are hashed using Argon2id
- Support for hardware security keys (WebAuthn)
- Built-in rate limiting and brute force protection
- Comprehensive audit logging
- CSRF protection
- XSS prevention

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

Hanzo ID is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.

## Support

- Documentation: https://docs.hanzo.ai/id
- Issues: https://github.com/hanzoai/id/issues
- Discord: https://discord.gg/hanzoai

## Acknowledgments

Hanzo ID is based on the excellent [Casdoor](https://github.com/casdoor/casdoor) project. We're grateful to the Casdoor team for creating such a robust ID foundation.

---

Built with ❤️ by the Hanzo team