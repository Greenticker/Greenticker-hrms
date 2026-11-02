from pydantic import BaseModel, EmailStr
from typing import Optional
from app.permissions.rbac import Role

class UserBase(BaseModel):
    email: EmailStr
    first_name: str
    last_name: str
    role: Role = Role.EMPLOYEE

class UserCreate(UserBase):
    password: str
    organization_id: Optional[str] = "org_zenith_default"

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[Role] = None
    user_id: Optional[str] = None
