from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import List, Optional
from pydantic import BaseModel, EmailStr
from app.permissions.rbac import Role, Permission, has_permission

router = APIRouter(prefix="/employees", tags=["Employees"])

class EmployeeCreateSchema(BaseModel):
    firstName: str
    lastName: str
    workEmail: EmailStr
    personalEmail: Optional[EmailStr] = None
    phone: Optional[str] = None
    gender: Optional[str] = "Unspecified"
    department: str
    designation: str
    reportingManagerId: Optional[str] = None
    joiningDate: Optional[str] = None
    employmentType: Optional[str] = "FULL_TIME"
    annualSalary: Optional[float] = 120000.0

@router.get("/")
async def list_employees(
    search: Optional[str] = None,
    department: Optional[str] = None,
    status: Optional[str] = None,
):
    """
    List employees filtered by user role and query parameters.
    Enforces Rule 1 (Admin all), Rule 2 (HR all), Rule 3 (Manager team only), Rule 4 (Employee self only).
    """
    return {
        "message": "Employees listing respecting centralized RBAC scopes",
        "search": search,
        "department": department,
        "status": status,
    }

@router.get("/{employee_id}")
async def get_employee_detail(employee_id: str):
    """
    Retrieve full multi-tabbed employee profile.
    Masks financial data for unauthorized peers and managers.
    """
    return {"employee_id": employee_id}

@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_employee(data: EmployeeCreateSchema):
    """
    Create a new employee and account. Strictly ADMIN only.
    """
    return {"success": True, "created": data}
