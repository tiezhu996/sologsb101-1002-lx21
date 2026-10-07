import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import 'antd/dist/reset.css';
import './styles/main.css';
import { appRoutes } from './router';

/** 主题：光伏绿 + 数据蓝，工程台账风格 */
const theme = {
  token: {
    colorPrimary: '#0f7b6c',
    colorInfo: '#1668dc',
    colorSuccess: '#237804',
    colorWarning: '#d46b08',
    colorError: '#a8071a',
    colorTextBase: '#12211f',
    borderRadius: 8,
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", system-ui, sans-serif',
  },
  components: {
    Layout: { headerBg: '#ffffff', siderBg: '#0b2a26' },
    Card: { headerBg: '#f6faf9' },
    Table: { headerBg: '#f2f7f6' },
  },
};

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

const router = createBrowserRouter(appRoutes);

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <RouterProvider router={router} />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
