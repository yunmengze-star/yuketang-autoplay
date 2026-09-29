# Yuketang Autoplay

适用于新版雨课堂（Yuketang）的 Tampermonkey 用户脚本。

用于在正常播放完成当前视频后，自动进入课程目录中的下一个视频。

## 功能

- 自动识别雨课堂视频播放器
- 当前视频播放完成后自动进入下一个视频
- 自动跳过作业等非视频内容
- 支持雨课堂 SPA 页面切换
- 支持动态替换视频源
- 防止重复触发导致连续跳过多个视频
- 支持自定义播放倍速
- 兼容浏览器自动播放限制
- 提供调试日志

## 安装

首先安装 Tampermonkey。

然后安装：

https://raw.githubusercontent.com/yunmengze-star/yuketang-autoplay/main/yuketang-autoplay.user.js

## 播放倍速

默认使用正常速度：

```javascript
playbackRate: 1.0
```

## 免责声明

本项目仅用于改善雨课堂网页端连续观看视频时的操作体验。

请在遵守学校、课程及平台相关规定的前提下使用本脚本。因使用本项目产生的相关影响与风险，由使用者自行承担。

本项目与雨课堂、学堂在线及其官方无任何关联。
