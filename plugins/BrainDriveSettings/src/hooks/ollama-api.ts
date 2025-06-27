// ollama-api.ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface OllamaClientConfig {
  baseUrl?: string;
}

interface CreateModelParams {
  name: string;
  from: string;
  system?: string;
  path?: string;
}

interface ModelInfo {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

interface TagsResponse {
  models: ModelInfo[];
}

interface PullParams {
  name: string;
  insecure?: boolean;
  stream?: boolean;
}

interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

class OllamaApiClient {
  private baseUrl: string;
  
  constructor(config: OllamaClientConfig = {}) {
    this.baseUrl = config.baseUrl 
      ? `${config.baseUrl.replace(/\/+$/, '')}/api`
      : 'http://localhost:11434/api';
  }
  
  private async request<T>(
    endpoint: string,
    method: HttpMethod,
    data?: any
  ): Promise<T> {
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    
    const options: RequestInit = {
      method,
      headers,
      redirect: 'follow',
        mode: 'cors', // Changed from 'no-cors'
      credentials: 'omit' // Don't send credentials
    };
    
    if (data) options.body = JSON.stringify(data);
    
    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}`, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }
      
      // Handle different response types
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return await response.json() as T;
      }
      return await response.text() as unknown as T;
    } catch (error) {
      console.error(`${method} ${endpoint} failed:`, error);
      throw error;
    }
  }

  // Streaming request method for pull operations
  private async streamingRequest(
    endpoint: string,
    method: HttpMethod,
    data: any,
    onProgress?: (progress: PullProgress) => void
  ): Promise<void> {
    const headers = new Headers();
    headers.append('Content-Type', 'application/json');
    
    const options: RequestInit = {
      method,
      headers,
      body: JSON.stringify(data),
      mode: 'no-cors', // Explicit CORS mode (this is the default)
      credentials: 'include'
    };
    
    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}`, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error (${response.status}): ${errorText}`);
      }
      
      if (!response.body) {
        throw new Error('Response body is null');
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const progress: PullProgress = JSON.parse(line);
            if (onProgress) {
              onProgress(progress);
            }
          } catch (parseError) {
            // Skip malformed JSON lines
            console.warn('Failed to parse progress line:', line);
          }
        }
      }
    } catch (error) {
      console.error(`Streaming ${method} ${endpoint} failed:`, error);
      throw error;
    }
  }
  
  // Model operations
  async showModel(modelName: string): Promise<string> {
    return this.request('show', 'POST', { name: modelName });
  }
  
  async copyModel(source: string, destination: string): Promise<string> {
    return this.request('copy', 'POST', { source, destination });
  }
  
  async createModel(params: CreateModelParams): Promise<string> {
    return this.request('create', 'POST', params);
  }
  
  async listModels(): Promise<TagsResponse> {
    return this.request('tags', 'GET');
  }
  
  async deleteModel(modelName: string): Promise<string> {
    return this.request('delete', 'DELETE', { name: modelName });
  }

  // Pull model with streaming support
  async pullModel(
    params: PullParams,
    onProgress?: (progress: PullProgress) => void
  ): Promise<void> {
    const pullParams = {
      ...params,
      stream: true // Always enable streaming for progress
    };
    
    await this.streamingRequest('pull', 'POST', pullParams, onProgress);
  }

  // Non-streaming pull (waits for completion)
  async pullModelSync(params: Omit<PullParams, 'stream'>): Promise<string> {
    return this.request('pull', 'POST', { ...params, stream: false });
  }
  
  // Getter for baseUrl  
  getBaseUrl(): string {
    return this.baseUrl;
  }
  
  // Update base URL dynamically
  setBaseUrl(url: string): void {
    this.baseUrl = `${url.replace(/\/+$/, '')}/api`;
  }
}

export default OllamaApiClient;

// Usage example:
/*
const client = new OllamaApiClient();

// Pull with streaming progress
await client.pullModel(
  { name: 'llama2:7b' },
  (progress) => {
    console.log(`Status: ${progress.status}`);
    if (progress.total && progress.completed) {
      const percent = (progress.completed / progress.total * 100).toFixed(1);
      console.log(`Progress: ${percent}%`);
    }
  }
);

// Or pull without streaming (synchronous)
const result = await client.pullModelSync({ name: 'llama2:7b' });
console.log(result);
*/