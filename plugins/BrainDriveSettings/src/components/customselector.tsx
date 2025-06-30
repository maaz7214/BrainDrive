import React from 'react';

interface CustomSelectProps {
  options: string[];
  value?: string;
  onChange: (value: string) => void;
}

interface CustomSelectState {
  isOpen: boolean;
  hoveredIndex: number | null;
}

class CustomSelect extends React.Component<CustomSelectProps, CustomSelectState> {
  private containerRef = React.createRef<HTMLDivElement>();

  constructor(props: CustomSelectProps) {
    super(props);
    this.state = {
      isOpen: false,
      hoveredIndex: null,
    };
  }

  componentDidMount() {
    document.addEventListener('click', this.handleClickOutside);
  }

  componentWillUnmount() {
    document.removeEventListener('click', this.handleClickOutside);
  }

  handleClickOutside = (event: MouseEvent) => {
    if (this.containerRef.current && !this.containerRef.current.contains(event.target as Node)) {
      this.setState({ isOpen: false });
    }
  };

  toggleDropdown = () => {
    this.setState((prev) => ({ isOpen: !prev.isOpen }));
  };

  selectOption = (value: string) => {
    this.setState({ isOpen: false });
    this.props.onChange(value);
  };

  setHover = (index: number | null) => {
    this.setState({ hoveredIndex: index });
  };

  render() {
    const { options, value } = this.props;
    const { isOpen, hoveredIndex } = this.state;

    // Check if dark theme is enabled
    const isDarkTheme = document.documentElement.classList.contains('dark-theme') || 
                        document.body.classList.contains('dark-theme');

    const styles = {
      container: {
        position: 'relative' as const,
        width: '98%',
        fontFamily: 'sans-serif',
      },
      header: {
        padding: '10px',
        border: `1px solid ${isDarkTheme ? 'var(--border-color, #555)' : 'var(--border-color, #ccc)'}`,
        backgroundColor: isDarkTheme ? 'var(--input-bg, #2a2a2a)' : 'var(--input-bg, #fff)',
        color: isDarkTheme ? 'var(--text-color, #fff)' : 'var(--text-color, #000)',
        cursor: 'pointer',
        borderRadius: '6px',
        userSelect: 'none' as const,
        fontSize: '16px',
        transition: 'border-color 0.2s ease, background-color 0.2s ease',
        minHeight: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      },
      headerFocused: {
        borderColor: isDarkTheme ? 'var(--button-primary-bg, #007bff)' : 'var(--button-primary-bg, #007bff)',
        boxShadow: `0 0 0 2px ${isDarkTheme ? 'rgba(0, 123, 255, 0.3)' : 'rgba(0, 123, 255, 0.2)'}`,
      },
      arrow: {
        width: '0',
        height: '0',
        borderLeft: '4px solid transparent',
        borderRight: '4px solid transparent',
        borderTop: `4px solid ${isDarkTheme ? 'var(--text-color, #fff)' : 'var(--text-color, #666)'}`,
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.2s ease',
        marginLeft: '8px',
      },
      options: {
        position: 'absolute' as const,
        top: '100%',
        left: 0,
        right: 0,
        maxHeight: '125px', 
        overflowY: 'auto' as const,
        border: `1px solid ${isDarkTheme ? 'var(--border-color, #555)' : 'var(--border-color, #ccc)'}`,
        borderTop: 'none',
        backgroundColor: isDarkTheme ? 'var(--input-bg, #2a2a2a)' : 'var(--input-bg, #fff)',
        zIndex: 9999, 
        borderRadius: '0 0 6px 6px',
        boxShadow: isDarkTheme 
          ? '0 4px 6px rgba(0, 0, 0, 0.3)' 
          : '0 4px 6px rgba(0, 0, 0, 0.1)',
        animation: 'fadeIn 0.15s ease-out',
      },
      option: (isHovered: boolean, isSelected: boolean) => ({
        padding: '10px',
        cursor: 'pointer',
        backgroundColor: isSelected 
          ? (isDarkTheme ? 'var(--button-primary-bg, #007bff)' : 'var(--button-primary-bg, #007bff)')
          : isHovered 
            ? (isDarkTheme ? 'var(--button-secondary-bg, #3a3a3a)' : 'var(--button-secondary-bg, #f0f0f0)')
            : 'transparent',
        color: isSelected 
          ? '#fff'
          : (isDarkTheme ? 'var(--text-color, #fff)' : 'var(--text-color, #000)'),
        transition: 'background-color 0.1s ease',
        fontSize: '14px',
      }),
      placeholder: {
        opacity: 0.7,
        fontStyle: 'italic',
      },
    };

    // Add CSS for animations and responsive design
    const css = `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-4px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Responsive styles for CustomSelect */
      @media (max-width: 768px) {
        .custom-select-container {
          width: 100% !important;
        }
        
        .custom-select-header {
          padding: 12px !important;
          font-size: 16px !important;
          min-height: 24px !important;
        }
        
        .custom-select-options {
          max-height: 150px !important;
        }
        
        .custom-select-option {
          padding: 12px !important;
          font-size: 16px !important;
        }
      }

      @media (max-width: 480px) {
        .custom-select-header {
          padding: 10px !important;
          font-size: 14px !important;
        }
        
        .custom-select-options {
          max-height: 120px !important;
        }
        
        .custom-select-option {
          padding: 10px !important;
          font-size: 14px !important;
        }
      }

      /* Custom scrollbar for dark theme */
      .custom-select-options::-webkit-scrollbar {
        width: 6px;
      }

      .custom-select-options::-webkit-scrollbar-track {
        background: ${isDarkTheme ? '#1a1a1a' : '#f1f1f1'};
        border-radius: 3px;
      }

      .custom-select-options::-webkit-scrollbar-thumb {
        background: ${isDarkTheme ? '#555' : '#ccc'};
        border-radius: 3px;
      }

      .custom-select-options::-webkit-scrollbar-thumb:hover {
        background: ${isDarkTheme ? '#777' : '#999'};
      }
    `;

    // Inject CSS if not already present
    if (!document.querySelector('#custom-select-styles')) {
      const styleElement = document.createElement('style');
      styleElement.id = 'custom-select-styles';
      styleElement.textContent = css;
      document.head.appendChild(styleElement);
    }

    return (
      <div 
        ref={this.containerRef}
        style={styles.container}
        className="custom-select-container"
      >
        <div 
          style={{
            ...styles.header,
            ...(isOpen ? styles.headerFocused : {})
          }}
          className="custom-select-header"
          onClick={this.toggleDropdown}
        >
          <span style={!value ? styles.placeholder : {}}>
            {value || 'Select a model'}
          </span>
          <div style={styles.arrow}></div>
        </div>
        {isOpen && (
          <div style={styles.options} className="custom-select-options">
            {options.map((option, index) => (
              <div
                key={option}
                style={styles.option(index === hoveredIndex, option === value)}
                className="custom-select-option"
                onMouseEnter={() => this.setHover(index)}
                onMouseLeave={() => this.setHover(null)}
                onClick={() => this.selectOption(option)}
              >
                {option}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
}

export default CustomSelect;