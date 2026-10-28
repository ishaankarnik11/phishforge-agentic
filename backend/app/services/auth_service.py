"""Auth service: password hashing, JWT creation and validation."""

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ALGORITHM = "HS256"


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    """Return bcrypt hash of *plain* password."""
    result: str = _pwd_context.hash(plain)
    return result


def verify_password(plain: str, hashed: str) -> bool:
    """Return True if *plain* matches *hashed*."""
    result: bool = _pwd_context.verify(plain, hashed)
    return result


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def create_access_token(user_id: int) -> str:
    """Create a signed JWT for *user_id* with configured expiry."""
    expire = datetime.now(tz=timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload: dict[str, object] = {"sub": str(user_id), "exp": expire}
    encoded: str = jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded


def decode_access_token(token: str) -> int:
    """Decode *token* and return the encoded user ID.

    Raises:
        JWTError: if the token is invalid or expired.
    """
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    sub: str | None = payload.get("sub")
    if sub is None:
        raise JWTError("Missing subject claim")
    return int(sub)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def create_user(db: AsyncSession, email: str, name: str, password: str) -> User:
    """Hash password and persist a new User row."""
    user = User(
        email=email,
        name=name,
        password_hash=hash_password(password),
        role="editor",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
