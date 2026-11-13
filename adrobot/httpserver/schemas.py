# pyright: strict
from pydantic import BaseModel


class ApiError(BaseModel):
    code: str
    message: str


class SuccessResponse[T](BaseModel):
    data: T
    error: None = None


class ErrorResponse(BaseModel):
    data: None = None
    error: ApiError
