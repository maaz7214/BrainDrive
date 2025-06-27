import React from "react";
import "./ComponentOllamaServer.css";
import {
  GearIcon,
  TagIcon,
  LinkIcon,
  KeyIcon,
  LightningIcon,
  UpdateIcon,
  TrashIcon,
  CloseIcon,
  PlusIcon,
} from "./icons";
import OllamaApiClient from "./hooks/ollama-api";

interface ApiResponse {
  data?: any;
  status?: number;
  id?: string;
  [key: string]: any;
}

interface OllamaApiResponse {
  status: string;
  version?: string;
}

interface ServerConfig {
  id: string; // Unique identifier for the server
  serverName: string; // Display name
  serverAddress: string; // URL
  apiKey: string; // Optional authentication
  connectionStatus: "idle" | "checking" | "success" | "error";
}

interface OllamaServerComponentProps {
  services: {
    api?: {
      get: (url: string, options?: any) => Promise<ApiResponse>;
      post: (url: string, data: any) => Promise<ApiResponse>;
      delete: (url: string, options?: any) => Promise<ApiResponse>;
    };
    theme?: {
      getCurrentTheme: () => string;
      addThemeChangeListener: (callback: (theme: string) => void) => void;
      removeThemeChangeListener: (callback: (theme: string) => void) => void;
    };
  };
}

interface OllamaServerComponentState {
  servers: ServerConfig[];
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string;
  currentTheme: string;
  activeServerId: string | null; // Currently selected server for editing
  isAddingNew: boolean; // Flag to indicate adding a new server
  existingSettingId: string | null; // ID of the existing settings instance
  ModelState: boolean; // Flag to indicate if model state is being fetched
  selectedModel?: string; // Currently selected model for operations
  modelList: string[]; // List of available models
  OllamaServername: string; // Temporary storage for new server name
  isPullingModel: boolean; // Flag to indicate if a model is being pulled
  isDeletingModel: boolean; // Flag to indicate if a model is being deleted
  pullProgress: string; // Progress message for pulling models
  showValidationError: boolean; // Flag to show validation error
}

class ComponentOllamaServer extends React.Component<
  OllamaServerComponentProps,
  OllamaServerComponentState
> {
  private themeChangeListener: ((theme: string) => void) | null = null;
  private ollamaClient: OllamaApiClient;
  constructor(props: OllamaServerComponentProps) {
    super(props);
    this.state = {
      servers: [],
      isLoading: true,
      isSaving: false,
      errorMessage: "",
      currentTheme: "light",
      activeServerId: null,
      isAddingNew: false,
      existingSettingId: null,
      ModelState: false,
      selectedModel: "", // Change this from "Select a model to delete" to empty string
      modelList: [], // Start with empty array instead of placeholder data
      OllamaServername: "",
      isPullingModel: false,
      isDeletingModel: false,
      pullProgress: "", // Add this missing property
      showValidationError: false,
    };
    this.ollamaClient = new OllamaApiClient();
  }

  componentDidMount() {
    this.loadSettings();
    this.initializeThemeService();
    this.loadModels();
  }

  updateOllamaClient = () => {
    const { servers, activeServerId } = this.state;
    const activeServer = servers.find((s) => s.id === activeServerId);

    if (activeServer) {
      this.ollamaClient.setBaseUrl(activeServer.serverAddress);
    }
  };

  loadModels = async () => {
    this.setState({ errorMessage: "" });

    try {
      this.updateOllamaClient();
      const response = await this.ollamaClient.listModels();

      // Extract model names more safely
      const modelNames = (response.models || [])
        .map((m: any) => {
          if (typeof m === "string") {
            return m;
          } else if (m && m.name) {
            return m.name;
          }
          return null;
        })
        .filter(Boolean); // Remove any null/undefined values

      this.setState({
        modelList: modelNames,
      });

      console.log("Models loaded:", modelNames);
    } catch (error: any) {
      console.error("Error loading models:", error);
      this.setState({
        modelList: [],
        errorMessage: `Error loading models: ${
          error.message || "Unknown error"
        }`,
      });
    }
  };

  pullModel = async () => {
    const { OllamaServername } = this.state;

    if (!OllamaServername.trim()) {
      this.setState({
        errorMessage: "Please enter a model name to pull",
        showValidationError: true,
      });
      return;
    }

    // Remove "ollama run " prefix if present (case insensitive)
    let cleanModelName = OllamaServername.trim();
    const ollamaRunPrefix = /^ollama\s+run\s+/i;
    if (ollamaRunPrefix.test(cleanModelName)) {
      cleanModelName = cleanModelName.replace(ollamaRunPrefix, "");
    }

    // Check if cleaned model name is empty
    if (!cleanModelName.trim()) {
      this.setState({ errorMessage: "Please enter a valid model name" });
      return;
    }

    // Check if model name is too long (max 100 characters as example)
    const MAX_MODEL_NAME_LENGTH = 60;
    if (cleanModelName.length > MAX_MODEL_NAME_LENGTH) {
      console.warn(`Model name is too long: ${cleanModelName}`);
      this.setState({
        isPullingModel: false,
        errorMessage: `Model name is too long. Maximum ${MAX_MODEL_NAME_LENGTH} characters allowed.`,
        pullProgress: "",
      });
      return;
    }

    this.setState({
      isPullingModel: true,
      errorMessage: "",
      pullProgress: "",
      showValidationError: false,
    });

    let hasError = false;
    let errorMessage = "";

    try {
      this.updateOllamaClient();

      await this.ollamaClient.pullModel(
        {
          name: OllamaServername.trim(),
          stream: true,
        },
        (progress) => {
          console.log("Pull progress:", progress);

          if (progress.error) {
            console.log("Progress error ", progress.error);
            hasError = true;
            errorMessage = `${progress.error}`;

            // Set error state immediately
            this.setState({
              pullProgress: errorMessage,
              errorMessage: errorMessage,
            });
            return; // Don't throw, just return
          }

          let progressMessage = `Status: ${progress.status}`;

          if (progress.total && progress.completed) {
            const percent = (
              (progress.completed / progress.total) *
              100
            ).toFixed(1);
            progressMessage += ` (${percent}%)`;
          }

          this.setState({ pullProgress: progressMessage });
        }
      );

      // Check if error occurred during streaming
      if (hasError) {
        throw new Error(errorMessage);
      }

      this.setState({
        isPullingModel: false,
        OllamaServername: "",
        errorMessage: "",
        pullProgress: "",
      });

      await this.loadModels();
      alert(`Model "${OllamaServername.trim()}" pulled successfully!`);
    } catch (error) {
      console.error("Error pulling model:", error);
      this.setState({
        isPullingModel: false,
        errorMessage: ` ${error || "Unknown error"}`,
        pullProgress: "",
      });
    }
  };

  componentWillUnmount() {
    if (this.themeChangeListener && this.props.services?.theme) {
      this.props.services.theme.removeThemeChangeListener(
        this.themeChangeListener
      );
    }
  }

  /**
   * Initialize the theme service to listen for theme changes
   */
  initializeThemeService() {
    if (this.props.services?.theme) {
      try {
        // Get the current theme
        const currentTheme = this.props.services.theme.getCurrentTheme();
        this.setState({ currentTheme });

        // Set up theme change listener
        this.themeChangeListener = (newTheme: string) => {
          this.setState({ currentTheme: newTheme });
        };

        // Add the listener to the theme service
        this.props.services.theme.addThemeChangeListener(
          this.themeChangeListener
        );
      } catch (error) {
        console.error("Error initializing theme service:", error);
      }
    }
  }

  deleteModel = async () => {
    const { selectedModel } = this.state;

    // Validate selected model
    console.log("Selected model for deletion:", selectedModel);

    if (
      !selectedModel ||
      selectedModel === "" ||
      selectedModel === "Select a model to delete"
    ) {
      this.setState({ errorMessage: "Please select a model to delete" });
      return;
    }

    if (
      !window.confirm(
        `Are you sure you want to delete the model "${selectedModel}"?`
      )
    ) {
      return;
    }

    this.setState({ isDeletingModel: true, errorMessage: "" });

    try {
      this.updateOllamaClient();
      await this.ollamaClient.deleteModel(selectedModel);

      // Clear the selected model BEFORE reloading the list
      this.setState({
        isDeletingModel: false,
        selectedModel: "", // Reset to empty string
        errorMessage: "",
      });

      // Reload models after successful deletion
      await this.loadModels();

      alert(`Model "${selectedModel}" deleted successfully!`);
    } catch (error: any) {
      console.error("Error deleting model:", error);
      this.setState({
        isDeletingModel: false,
        errorMessage: `Error deleting model: ${
          error.message || "Unknown error"
        }`,
      });
    }
  };

  /**
   * Generate a unique ID for a new server
   */
  generateUniqueId = () => {
    return (
      "server_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9)
    );
  };

  loadSettings = async () => {
    this.setState({ isLoading: true, errorMessage: "" });

    if (!this.props.services?.api) {
      this.setState({
        isLoading: false,
        errorMessage: "API service not available",
      });
      return;
    }

    try {
      const response = await this.props.services.api.get(
        "/api/v1/settings/instances",
        {
          params: {
            definition_id: "ollama_servers_settings",
            scope: "user",
            user_id: "current",
          },
        }
      );

      let settingsData = null;

      if (Array.isArray(response) && response.length > 0) {
        settingsData = response[0];
      } else if (response && typeof response === "object") {
        const responseObj = response as Record<string, any>;

        if (responseObj.data) {
          if (Array.isArray(responseObj.data) && responseObj.data.length > 0) {
            settingsData = responseObj.data[0];
          } else if (typeof responseObj.data === "object") {
            settingsData = responseObj.data;
          }
        } else {
          settingsData = response;
        }
      }

      if (settingsData && settingsData.value) {
        let parsedValue =
          typeof settingsData.value === "string"
            ? JSON.parse(settingsData.value)
            : settingsData.value;

        // Ensure servers is an array and each server has a connectionStatus
        const servers: ServerConfig[] = [];

        if (Array.isArray(parsedValue.servers)) {
          for (const server of parsedValue.servers) {
            // Ensure connectionStatus is one of the allowed values
            let status: "idle" | "checking" | "success" | "error" = "idle";
            if (
              server.connectionStatus === "checking" ||
              server.connectionStatus === "success" ||
              server.connectionStatus === "error"
            ) {
              status = server.connectionStatus;
            }

            servers.push({
              id: server.id,
              serverName: server.serverName,
              serverAddress: server.serverAddress,
              apiKey: server.apiKey || "",
              connectionStatus: status,
            });
          }
        }

        this.setState({
          servers,
          isLoading: false,
          errorMessage: "",
          existingSettingId: settingsData.id,
        });
      } else {
        // No existing settings, initialize with empty array
        this.setState({
          servers: [],
          isLoading: false,
          errorMessage: "",
        });
      }
    } catch (error: any) {
      this.setState({
        isLoading: false,
        errorMessage: `Error loading settings: ${
          error.message || "Unknown error"
        }`,
      });
    }
  };

  saveSettings = async () => {
    if (!this.props.services?.api) {
      this.setState({ errorMessage: "API service not available" });
      return;
    }

    this.setState({ isSaving: true, errorMessage: "" });

    // Create a properly typed array of server configs
    const serverConfigs: ServerConfig[] = [];

    for (const server of this.state.servers) {
      serverConfigs.push({
        id: server.id,
        serverName: server.serverName,
        serverAddress: server.serverAddress,
        apiKey: server.apiKey,
        connectionStatus: "idle",
      });
    }

    const settingsData = {
      definition_id: "ollama_servers_settings",
      name: "Ollama Servers Settings",
      value: {
        servers: serverConfigs,
      },
      scope: "user",
      user_id: "current",
    };

    // Include the existing setting ID if it exists
    if (this.state.existingSettingId) {
      (settingsData as any).id = this.state.existingSettingId;
    }

    try {
      const response = await this.props.services.api.post(
        "/api/v1/settings/instances",
        settingsData
      );

      this.setState({
        isSaving: false,
        errorMessage: "",
        isAddingNew: false,
        activeServerId: null,
        existingSettingId: response?.id || this.state.existingSettingId,
      });

      alert(
        this.state.existingSettingId
          ? "Settings updated successfully!"
          : "Settings saved successfully!"
      );
    } catch (error: any) {
      this.setState({
        isSaving: false,
        errorMessage: `Error saving settings: ${
          error.message || "Unknown error"
        }`,
      });
    }
  };

  addNewServer = () => {
    this.setState({ ModelState: false });
    const newServer: ServerConfig = {
      id: this.generateUniqueId(),
      serverName: "New Server",
      serverAddress: "http://localhost:11434",
      apiKey: "",
      connectionStatus: "idle",
    };

    this.setState({
      isAddingNew: true,
      activeServerId: newServer.id,
      servers: [...this.state.servers, newServer],
    });
  };

  selectServer = (serverId: string) => {
    this.setState({
      activeServerId: serverId,
      isAddingNew: false,
    });
  };

  deleteServer = (serverId: string) => {
    if (!window.confirm("Are you sure you want to delete this server?")) {
      return;
    }

    const updatedServers = this.state.servers.filter(
      (server) => server.id !== serverId
    );

    this.setState(
      {
        servers: updatedServers,
        activeServerId: null,
        isAddingNew: false,
      },
      () => {
        this.saveSettings();
      }
    );
  };

  cancelEdit = () => {
    if (this.state.isAddingNew) {
      // Remove the new server that was being added
      const updatedServers = this.state.servers.filter(
        (server) => server.id !== this.state.activeServerId
      );
      this.setState({
        servers: updatedServers,
        activeServerId: null,
        isAddingNew: false,
      });
    } else {
      // Just cancel editing
      this.setState({
        activeServerId: null,
        isAddingNew: false,
      });
    }
  };

  handleInputChange = (
    serverId: string,
    field: "serverName" | "serverAddress" | "apiKey",
    value: string
  ) => {
    const updatedServers = this.state.servers.map((server) => {
      if (server.id === serverId) {
        if (field === "serverName") {
          return { ...server, serverName: value };
        } else if (field === "serverAddress") {
          return { ...server, serverAddress: value };
        } else if (field === "apiKey") {
          return { ...server, apiKey: value };
        }
      }
      return server;
    });

    this.setState({ servers: updatedServers });
  };

  testConnection = async (serverId: string) => {
    const server = this.state.servers.find((s) => s.id === serverId);
    console.log("Testing connection for server:", serverId);
    if (!server) return;

    const updatedServers = this.state.servers.map((s) => {
      if (s.id === serverId) {
        return { ...s, connectionStatus: "checking" as const };
      }
      return s;
    });

    this.setState({
      servers: updatedServers,
      errorMessage: "",
    });

    if (!this.props.services?.api) {
      this.updateServerStatus(serverId, "error");
      this.setState({ errorMessage: "API service not available" });
      return;
    }

    try {
      const encodedUrl = encodeURIComponent(server.serverAddress);
      const params: Record<string, string> = { server_url: encodedUrl };

      if (server.apiKey) {
        params.api_key = server.apiKey;
      }

      const response = await this.props.services.api.get(
        "/api/v1/ollama/test",
        { params }
      );
      const responseData = response as unknown as OllamaApiResponse;

      if (responseData && responseData.status === "success") {
        this.updateServerStatus(serverId, "success");
      } else {
        this.updateServerStatus(serverId, "error");
        this.setState({
          errorMessage:
            "Connection failed. Please check your server address and API key.",
        });
      }
    } catch (error: any) {
      this.updateServerStatus(serverId, "error");
      this.setState({
        errorMessage:
          "Connection failed. Please check your server address and API key.",
      });
    }
  };

  updateServerStatus = (
    serverId: string,
    status: "idle" | "checking" | "success" | "error"
  ) => {
    const updatedServers = this.state.servers.map((server) => {
      if (server.id === serverId) {
        return { ...server, connectionStatus: status };
      }
      return server;
    });

    this.setState({ servers: updatedServers });
  };

  updateServer = (serverId: string) => {
    const server = this.state.servers.find((s) => s.id === serverId);
    if (!server) return;

    if (!server.serverName.trim() || !server.serverAddress.trim()) {
      this.setState({ errorMessage: "Server name and address are required" });
      return;
    }

    // Update the server in state
    const updatedServers = this.state.servers.map((s) => {
      if (s.id === serverId) {
        return {
          ...s,
          serverName: s.serverName.trim(),
          serverAddress: s.serverAddress.trim(),
        };
      }
      return s;
    });

    this.setState(
      {
        servers: updatedServers,
        activeServerId: null,
        isAddingNew: false,
      },
      () => {
        this.saveSettings();
      }
    );
  };

  renderServerList() {
    const { servers, activeServerId } = this.state;

    return (
      <div className="server-list">
        <h3 className="server-list-title">Ollama Servers</h3>

        {servers.length === 0 ? (
          <div className="no-servers">No servers configured</div>
        ) : (
          <ul className="server-items">
            {servers.map((server) => (
              <li
                key={server.id}
                className={`server-item ${
                  activeServerId === server.id ? "active" : ""
                }`}
                onClick={() => this.selectServer(server.id)}
              >
                <div className="server-item-content">
                  <div className="server-name">{server.serverName}</div>
                  <div className="server-address">{server.serverAddress}</div>
                </div>
                <div
                  className={`server-status status-${server.connectionStatus}`}
                >
                  {server.connectionStatus === "success" && <LightningIcon />}
                  {server.connectionStatus === "error" && <CloseIcon />}
                  {server.connectionStatus === "checking" && (
                    <div className="spinner-small" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          className="button button-primary add-server-button"
          onClick={this.addNewServer}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ marginRight: "8px" }}>
              <PlusIcon />
            </div>
            <span>Add New Server</span>
          </div>
        </button>
      </div>
    );
  }

  renderServerDetail() {
    const { servers, activeServerId, errorMessage } = this.state;

    if (!activeServerId) return null;

    const server = servers.find((s) => s.id === activeServerId);
    if (!server) return null;

    return (
      <div className="server-detail">
        <div className="server-detail-header">
          <div className="button-group" style={{ display: "flex", gap: "8px" }}>
            <button
              className={`button ${
                this.state.ModelState ? "button-secondary" : "button-primary"
              } add-server-button`}
              onClick={() => this.setState({ ModelState: false })}
            >
              {this.state.isAddingNew ? "Add New Server" : "Edit Server"}
            </button>

            {!this.state.isAddingNew && (
              <button
                className={`button ${
                  this.state.ModelState ? "button-primary" : "button-secondary"
                } cancel-button`}
                onClick={() => this.setState({ ModelState: true })}
              >
                Model Management
              </button>
            )}
          </div>
          <button
            className="button-icon"
            onClick={this.cancelEdit}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {/* {errorMessage && (
          <div className="form-section">
            <div className="status-indicator status-error">{errorMessage}</div>
          </div>
        )} */}

        {!this.state.ModelState ? (
          <div className="form-section">
            {errorMessage && (
              <div className="form-section">
                <div className="status-indicator status-error">
                  {errorMessage}
                </div>
              </div>
            )}
            <div className="form-row">
              <div className="input-group">
                <label className="input-label">
                  <div className="label-container">
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ marginRight: "8px" }}>
                        <GearIcon />
                      </div>
                      <span>Server Name</span>
                    </div>
                    <span className="label-description">
                      Name for this Ollama server
                    </span>
                  </div>
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={server.serverName}
                  onChange={(e) =>
                    this.handleInputChange(
                      server.id,
                      "serverName",
                      e.target.value
                    )
                  }
                  placeholder="Enter server name"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="input-group">
                <label className="input-label">
                  <div className="label-container">
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ marginRight: "8px" }}>
                        <LinkIcon />
                      </div>
                      <span>Server Address</span>
                    </div>
                    <span className="label-description">
                      URL of the Ollama server
                    </span>
                  </div>
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={server.serverAddress}
                  onChange={(e) =>
                    this.handleInputChange(
                      server.id,
                      "serverAddress",
                      e.target.value
                    )
                  }
                  placeholder="Enter server address"
                />
              </div>
            </div>

            <div className="form-row">
              <div className="input-group">
                <label className="input-label">
                  <div className="label-container">
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ marginRight: "8px" }}>
                        <KeyIcon />
                      </div>
                      <span>API Key (Optional)</span>
                    </div>
                    <span className="label-description">
                      Authentication key (if required)
                    </span>
                  </div>
                </label>
                <input
                  type="password"
                  className="input-field"
                  value={server.apiKey}
                  onChange={(e) =>
                    this.handleInputChange(server.id, "apiKey", e.target.value)
                  }
                  placeholder="Enter API key (optional)"
                />
              </div>
            </div>

            {server.connectionStatus !== "idle" && (
              <div
                className={`status-indicator status-${server.connectionStatus}`}
              >
                {server.connectionStatus === "checking" && (
                  <>
                    <div className="spinner" />
                    Testing connection...
                  </>
                )}
                {server.connectionStatus === "success" && (
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ marginRight: "8px" }}>
                      <LightningIcon />
                    </div>
                    <span>Connection successful!</span>
                  </div>
                )}
                {server.connectionStatus === "error" && (
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ marginRight: "8px" }}>
                      <CloseIcon />
                    </div>
                    <span>Connection failed</span>
                  </div>
                )}
              </div>
            )}

            <div className="button-group">
              <button
                className="button button-secondary"
                onClick={() => this.testConnection(server.id)}
              >
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ marginRight: "8px" }}>
                    <UpdateIcon />
                  </div>
                  <span>Test Connection</span>
                </div>
              </button>

              <button
                className="button button-primary"
                onClick={() => this.updateServer(server.id)}
              >
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ marginRight: "8px" }}>
                    <LightningIcon />
                  </div>
                  <span>
                    {this.state.isAddingNew ? "Add Server" : "Update Server"}
                  </span>
                </div>
              </button>

              {!this.state.isAddingNew && (
                <button
                  className="button button-danger"
                  onClick={() => this.deleteServer(server.id)}
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ marginRight: "8px" }}>
                      <TrashIcon />
                    </div>
                    <span>Delete Server</span>
                  </div>
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="ModalManagement">
            {errorMessage && (
              <div className="form-section">
                <div className="status-indicator status-error">
                  {errorMessage}
                </div>
              </div>
            )}
            <input
              type="text"
              className={`input-field ${
                this.state.showValidationError &&
                !this.state.OllamaServername.trim()
                  ? "input-error"
                  : ""
              }`}
              value={this.state.OllamaServername}
              placeholder="Enter Ollama server name"
              onChange={(e) => {
                this.setState({
                  OllamaServername: e.target.value,
                  showValidationError: false, // Clear error when user starts typing
                });
              }}
              disabled={this.state.isPullingModel}
            />
            <div className="group-pull">
              <button
                className="button button-pull"
                // onClick={() => this.updateServer(server.id)}
                onClick={this.pullModel}
                disabled={this.state.isPullingModel}
              >
                <div style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ marginRight: "8px" }}>
                    <TagIcon />
                  </div>
                  <span>Pull</span>
                </div>
              </button>
            </div>
            {this.state.isPullingModel && (
              <div className="bg-green-100 text-green-800 px-4 py-2 rounded mb-2 text-sm border border-green-300">
                This may take some time to download...
              </div>
            )}
            {this.state.isPullingModel && this.state.pullProgress && (
              <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded mb-2 text-sm border border-blue-300">
                <div className="spinner" />
                <span>Pulling model...</span>
                {this.state.pullProgress}
              </div>
            )}
            <div className="button-group">
              <select
                className="input-field"
                value={this.state.selectedModel}
                onChange={(e) =>
                  this.setState({ selectedModel: e.target.value })
                }
              >
                <option value="" disabled>
                  Select a model
                </option>
                {this.state.modelList.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <div className="group-pull">
                <button
                  className=" button button-danger "
                  // onClick={() => }
                  style={{ width: "160px", height: "40px" }}
                  onClick={this.deleteModel}
                  disabled={
                    this.state.isDeletingModel ||
                    !this.state.selectedModel ||
                    this.state.selectedModel === "Select a model to delete" ||
                    this.state.modelList.length === 0
                  }
                >
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ marginRight: "8px" }}>
                      <TrashIcon />
                    </div>
                    <span>Delete</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  render() {
    const { isLoading } = this.state;
    const themeClass = this.state.currentTheme === "dark" ? "dark-theme" : "";

    if (isLoading) {
      return (
        <div className={`ollama-container ${themeClass}`}>
          <div className="ollama-paper">
            <div className="loading-spinner">
              <div className="spinner" />
              <span>Loading settings...</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`ollama-container ${themeClass}`}>
        <div className="ollama-paper">
          <div className="ollama-server-layout">
            {this.renderServerList()}
            {this.state.activeServerId && this.renderServerDetail()}
            {!this.state.activeServerId && (
              <div className="server-detail-placeholder">
                <div className="placeholder-content">
                  <div style={{ marginBottom: "16px" }}>
                    <GearIcon />
                  </div>
                  <p>Select a server to edit or add a new server</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ComponentOllamaServer;
