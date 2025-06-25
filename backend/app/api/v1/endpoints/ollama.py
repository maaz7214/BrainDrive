from fastapi import APIRouter, HTTPException, Depends, Body, Response, Query  
from fastapi.responses import StreamingResponse
import httpx
import json
import asyncio
from typing import Optional, List, Dict, Any, AsyncGenerator
from pydantic import BaseModel, AnyHttpUrl
from urllib.parse import unquote
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.settings import SettingDefinition, SettingScope

router = APIRouter()

class OllamaResponse(BaseModel):
    status: str
    version: Optional[str] = None

class LibraryModelsResponse(BaseModel):
    models: List[Dict[str, Any]]
    total_count: int
    limit: int
    skip: int
    data_updated: str

async def ensure_ollama_settings_definition(db: AsyncSession):
    """Ensure the Ollama settings definition exists"""
    definition = await SettingDefinition.get_by_id(db, 'ollama_settings')
    if not definition:
        definition = SettingDefinition(
            id='ollama_settings',
            name='Ollama Server Settings',
            description='Configuration for the Ollama server connection',
            category='servers',
            type='object',
            allowed_scopes=[SettingScope.USER],
            validation={
                'required': ['serverAddress', 'serverName'],
                'properties': {
                    'serverAddress': {'type': 'string', 'format': 'uri'},
                    'serverName': {'type': 'string', 'minLength': 1},
                    'apiKey': {'type': 'string'}
                }
            }
        )
        await definition.save(db)
    return definition

@router.get("/test", response_model=OllamaResponse)
async def test_ollama_connection(
    server_url: str,
    api_key: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Test connection to an Ollama server by checking its version endpoint
    """
    # Ensure settings definition exists
    # await ensure_ollama_settings_definition(db)

    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Ensure the URL ends with /api/version
        if not server_url.endswith('/api/version'):
            server_url = server_url.rstrip('/') + '/api/version'
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        # Set a reasonable timeout and disable redirects
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            try:
                response = await client.get(server_url, headers=headers)
                if response.status_code == 200:
                    return OllamaResponse(
                        status="success",
                        version=response.json().get("version", "unknown")
                    )
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Server returned status code {response.status_code}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

async def stream_response(response: httpx.Response) -> AsyncGenerator[bytes, None]:
    """
    Stream the response from Ollama API
    
    Ollama's streaming format is a series of newline-delimited JSON objects.
    Each JSON object contains a 'response' field with a chunk of text.
    """
    try:
        async for line in response.aiter_lines():
            if line.strip():
                try:
                    # Parse the JSON and yield it back as a properly formatted JSON line
                    data = json.loads(line)
                    # Add a newline to ensure proper streaming format
                    yield json.dumps(data).encode() + b'\n'
                except json.JSONDecodeError:
                    # If it's not valid JSON, just pass it through
                    yield line.encode() + b'\n'
    except Exception as e:
        print(f"Error in stream_response: {e}")
        error_json = json.dumps({"error": str(e)})
        yield error_json.encode() + b'\n'

@router.post("/passthrough")
async def ollama_passthrough(
    request_data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Generic passthrough for Ollama API requests (non-streaming)
    """
    try:
        # Extract required parameters
        server_url = request_data.get("server_url")
        endpoint = request_data.get("endpoint")
        method = request_data.get("method", "GET").upper()
        api_key = request_data.get("api_key")
        payload = request_data.get("payload", {})
        
        # Validate required parameters
        if not server_url or not endpoint:
            raise HTTPException(
                status_code=400,
                detail="server_url and endpoint are required"
            )
            
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )
            
        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/{endpoint.lstrip('/')}"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Set a longer timeout for large models and disable redirects
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            try:
                if method == "GET":
                    response = await client.get(full_url, headers=headers, params=payload)
                elif method == "POST":
                    response = await client.post(full_url, headers=headers, json=payload)
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported method: {method}"
                    )
                
                # Return the response data
                return {
                    "status_code": response.status_code,
                    "data": response.json() if response.headers.get("content-type") == "application/json" else response.text
                }
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

@router.post("/stream")
async def ollama_stream(
    request_data: Dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Streaming endpoint for Ollama API requests
    """
    try:
        # Extract required parameters
        server_url = request_data.get("server_url")
        endpoint = request_data.get("endpoint")
        method = request_data.get("method", "POST").upper()  # Default to POST for streaming
        api_key = request_data.get("api_key")
        payload = request_data.get("payload", {})
        
        # Ensure streaming is enabled in the payload
        if isinstance(payload, dict):
            payload["stream"] = True
        
        # Validate required parameters
        if not server_url or not endpoint:
            raise HTTPException(
                status_code=400,
                detail="server_url and endpoint are required"
            )
            
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )
            
        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/{endpoint.lstrip('/')}"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Set a longer timeout for large models and disable redirects
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            try:
                if method == "GET":
                    response = await client.get(full_url, headers=headers, params=payload, stream=True)
                elif method == "POST":
                    response = await client.post(full_url, headers=headers, json=payload, stream=True)
                else:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Unsupported method: {method}"
                    )
                
                # Return a streaming response
                return StreamingResponse(
                    stream_response(response),
                    media_type="application/json",
                    status_code=response.status_code
                )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )

@router.get("/models", response_model=List[Dict[str, Any]])
async def get_ollama_models(
    server_url: str,
    api_key: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a list of available models from an Ollama server
    """
    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Ensure the URL ends with /api/tags
        if not server_url.endswith('/api/tags'):
            server_url = server_url.rstrip('/') + '/api/tags'
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'

        # Set a reasonable timeout and disable redirects
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            try:
                response = await client.get(server_url, headers=headers)
                if response.status_code == 200:
                    # Extract the models from the response
                    models = response.json().get("models", [])
                    return models
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Server returned status code {response.status_code}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out. Server might be down or unreachable."
                )
            except httpx.ConnectError:
                raise HTTPException(
                    status_code=503,
                    detail="Could not connect to server. Please check if the server is running."
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error connecting to Ollama server: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )



@router.post("/pull")
async def pull_ollama_model(
    model_name: str = Body(..., embed=True),
    server_url: str = Body(...),
    api_key: Optional[str] = Body(None),
    insecure: bool = Body(False),
    db: AsyncSession = Depends(get_db)
):
    """
    Pull a model from the Ollama library with streaming progress
    """
    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/api/pull"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Prepare payload
        payload = {
            "name": model_name,
            "insecure": insecure,
            "stream": True
        }
        
        # Set timeout and disable redirects
        async with httpx.AsyncClient(timeout=120.0, follow_redirects=False) as client:
            try:
                response = await client.post(full_url, headers=headers, json=payload)
                
                # Return streaming response
                return StreamingResponse(
                    stream_response(response),
                    media_type="application/x-ndjson",
                    status_code=response.status_code
                )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Connection timed out during model pull"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error pulling model: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during model pull: {str(e)}"
        )

@router.delete("/model/{model_name}")
async def delete_ollama_model(
    model_name: str,
    server_url: str = Query(...),
    api_key: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a model from the Ollama server
    """
    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/api/delete"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Prepare payload
        payload = {"name": model_name}
        
        # Set timeout and disable redirects
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            try:
                response = await client.delete(full_url, headers=headers, json=payload)
                
                if response.status_code == 200:
                    return {"status": "success", "model": model_name}
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Delete failed: {response.text}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Delete operation timed out"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error deleting model: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during model deletion: {str(e)}"
        )

@router.get("/model/{model_name}", response_model=Dict[str, Any])
async def get_ollama_model_details(
    model_name: str,
    server_url: str = Query(...),
    api_key: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Get details about a specific model
    """
    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/api/show"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Prepare payload
        payload = {"name": model_name}
        
        # Set timeout and disable redirects
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            try:
                response = await client.post(full_url, headers=headers, json=payload)
                
                if response.status_code == 200:
                    return response.json()
                else:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Failed to get model details: {response.text}"
                    )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Model details request timed out"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error fetching model details: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error fetching model details: {str(e)}"
        )

@router.post("/create")
async def create_ollama_model(
    model_name: str = Body(..., embed=True),
    modelfile: str = Body(..., embed=True),
    server_url: str = Body(...),
    api_key: Optional[str] = Body(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new model from a Modelfile with streaming response
    """
    try:
        # Clean and validate the URL
        server_url = unquote(server_url).strip()
        if not server_url.startswith(('http://', 'https://')):
            raise HTTPException(
                status_code=400,
                detail="Invalid server URL. Must start with http:// or https://"
            )

        # Construct the full URL
        full_url = f"{server_url.rstrip('/')}/api/create"
        
        # Prepare headers
        headers = {'Content-Type': 'application/json'}
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
            
        # Prepare payload
        payload = {
            "name": model_name,
            "modelfile": modelfile,
            "stream": True
        }
        
        # Set timeout and disable redirects
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=False) as client:
            try:
                response = await client.post(full_url, headers=headers, json=payload)
                
                # Return streaming response
                return StreamingResponse(
                    stream_response(response),
                    media_type="application/x-ndjson",
                    status_code=response.status_code
                )
            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail="Model creation timed out"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Error creating model: {str(e)}"
                )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error during model creation: {str(e)}"
        )
    
@router.get("/library/models", response_model=LibraryModelsResponse)
async def get_ollama_library_models():
    """
    Get all available models from the Ollama library (ollamadb.dev)
    with pagination support to fetch all results
    """
    try:
        all_models = []
        total_count = 0
        page_size = 100  # Number of items to fetch per request
        skip = 0
        data_updated = None
        
        async with httpx.AsyncClient(timeout=30.0) as client:  # Increased timeout for multiple requests
            while True:
                url = f'https://ollamadb.dev/api/v1/models?skip={skip}&limit={page_size}'
                response = await client.get(url)
                
                if response.status_code != 200:
                    raise HTTPException(
                        status_code=response.status_code,
                        detail=f"Failed to fetch models: {response.text}"
                    )
                
                data = response.json()
                models = data.get('models', [])
                all_models.extend(models)
                
                # Capture metadata from the first page
                if skip == 0:
                    total_count = data.get('total_count', 0)
                    data_updated = data.get('data_updated')
                
                # Exit loop if we have all models or no more models
                if not models or len(all_models) >= total_count:
                    break
                    
                skip = len(all_models)  # Set skip to current count for next page
            
            return {
                "models": all_models,
                "total_count": total_count,
                "limit": len(all_models),
                "skip": 0,
                "data_updated": data_updated
            }
            
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="Connection to Ollama library timed out"
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Error connecting to Ollama library: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        )