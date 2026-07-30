from flask import Flask, request, jsonify
import requests
import json
import uuid
import time
import re

app = Flask(__name__)

def scrape_fresh_session():
    session = requests.Session()
    
    url = 'https://www.perplexity.ai'
    headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Redmi 8A Dual Build/QKQ1.191014.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'sec-ch-ua-platform': '"Android"',
        'sec-ch-ua': '"Android WebView";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
        'sec-ch-ua-mobile': '?1',
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
        'priority': 'u=0, i',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
    }
    
    response = session.get(url, headers=headers, timeout=30)
    html = response.text
    
    cookies = {}
    for cookie in session.cookies:
        cookies[cookie.name] = cookie.value
    
    visitor_id = cookies.get('pplx.visitor-id', str(uuid.uuid4()))
    session_id = cookies.get('pplx.session-id', str(uuid.uuid4()))
    
    version_match = re.search(r'"version":"([\d.]+)"', html)
    version = version_match.group(1) if version_match else '2.18'
    
    csrf_match = re.search(r'csrf-token["\']?\s*[:=]\s*["\']([^"\']+)', html)
    csrf_token = csrf_match.group(1) if csrf_match else f'{uuid.uuid4().hex}%7C{uuid.uuid4().hex}'
    
    buildId_match = re.search(r'"buildId":"([^"]+)"', html)
    buildId = buildId_match.group(1) if buildId_match else None
    
    api_url_match = re.search(r'"apiUrl":"([^"]+)"', html)
    api_url = api_url_match.group(1) if api_url_match else 'https://www.perplexity.ai/rest/sse/perplexity_ask'
    
    current_time = int(time.time())
    
    scraped_data = {
        'session': session,
        'cookies': cookies,
        'visitor_id': visitor_id,
        'session_id': session_id,
        'version': version,
        'csrf_token': csrf_token,
        'buildId': buildId,
        'api_url': api_url,
        'timestamp': current_time
    }
    
    return scraped_data

def parse_response(full_response):
    answer_text = ''
    sources = []
    metadata = {}
    
    lines = full_response.strip().split('\n')
    
    for line in lines:
        if not line.startswith('data: '):
            continue
            
        json_str = line[6:].strip()
        
        if not json_str or json_str == '{}':
            continue
        
        try:
            data = json.loads(json_str)
            
            if 'backend_uuid' in data:
                metadata['backend_uuid'] = data['backend_uuid']
            
            if 'text' in data and data.get('step_type') == 'FINAL':
                text_content = data['text']
                
                try:
                    steps = json.loads(text_content)
                    
                    if isinstance(steps, list):
                        for step in steps:
                            if step.get('step_type') == 'FINAL':
                                answer_str = step.get('content', {}).get('answer', '')
                                
                                if answer_str:
                                    answer_data = json.loads(answer_str)
                                    answer_text = answer_data.get('answer', '')
                                    sources = answer_data.get('web_results', [])
                                    
                                    if not sources:
                                        sources = answer_data.get('extra_web_results', [])
                                    
                                    break
                except:
                    pass
            
            if 'blocks' in data and not answer_text:
                for block in data['blocks']:
                    if block.get('intended_usage') in ['ask_text_0_markdown', 'ask_text']:
                        markdown_block = block.get('markdown_block', {})
                        if markdown_block.get('answer'):
                            answer_text = markdown_block['answer']
                            break
        
        except:
            continue
    
    return answer_text.strip(), sources, metadata

@app.route('/api/ask', methods=['GET'])
def perplexity_ask():
    prompt = request.args.get('prompt')
    
    if not prompt:
        return jsonify({
            'status': 'error',
            'message': 'Prompt parameter is required',
            'apidev': '@ISmartCoder',
            'api_channel': '@abirxdhackz'
        }), 400
    
    mode = request.args.get('mode', 'concise')
    model = request.args.get('model', 'turbo')
    search_focus = request.args.get('search_focus', 'internet')
    
    try:
        scraped = scrape_fresh_session()
        
        session = scraped['session']
        base_cookies = scraped['cookies']
        visitor_id = scraped['visitor_id']
        session_id = scraped['session_id']
        version = scraped['version']
        csrf_token = scraped['csrf_token']
        api_url = scraped['api_url']
        current_time = scraped['timestamp']
        
        frontend_uuid = str(uuid.uuid4())
        backend_uuid = str(uuid.uuid4())
        read_write_token = str(uuid.uuid4())
        request_id = str(uuid.uuid4())
        
        payload = {
            "params": {
                "last_backend_uuid": backend_uuid,
                "read_write_token": read_write_token,
                "attachments": [],
                "language": "en-US",
                "timezone": "Asia/Dhaka",
                "search_focus": search_focus,
                "sources": ["web"],
                "frontend_uuid": frontend_uuid,
                "mode": mode,
                "model_preference": model,
                "is_related_query": False,
                "is_sponsored": False,
                "prompt_source": "user",
                "query_source": "followup",
                "is_incognito": False,
                "time_from_first_type": 1485.7000000178814,
                "local_search_enabled": False,
                "use_schematized_api": True,
                "send_back_text_in_streaming_api": False,
                "supported_block_use_cases": [
                    "answer_modes",
                    "media_items",
                    "knowledge_cards",
                    "inline_entity_cards",
                    "place_widgets",
                    "finance_widgets",
                    "prediction_market_widgets",
                    "sports_widgets",
                    "flight_status_widgets",
                    "news_widgets",
                    "shopping_widgets",
                    "jobs_widgets",
                    "search_result_widgets",
                    "inline_images",
                    "inline_assets",
                    "placeholder_cards",
                    "diff_blocks",
                    "inline_knowledge_cards",
                    "entity_group_v2",
                    "refinement_filters",
                    "canvas_mode",
                    "maps_preview",
                    "answer_tabs",
                    "price_comparison_widgets",
                    "preserve_latex",
                    "in_context_suggestions"
                ],
                "client_coordinates": None,
                "mentions": [],
                "skip_search_enabled": True,
                "is_nav_suggestions_disabled": False,
                "followup_source": "link",
                "source": "mweb",
                "always_search_override": False,
                "override_no_search": False,
                "should_ask_for_mcp_tool_confirmation": True,
                "supported_features": ["browser_agent_permission_banner_v1.1"],
                "version": version
            },
            "query_str": prompt
        }
        
        additional_cookies = {
            'pplx.visitor-id': visitor_id,
            'pplx.session-id': session_id,
            'next-auth.csrf-token': csrf_token,
            'next-auth.callback-url': 'https%3A%2F%2Fwww.perplexity.ai%2Fapi%2Fauth%2Fsignin-callback%3Fredirect%3Dhttps%253A%252F%252Fwww.perplexity.ai',
            'pplx.mweb-splash-page-dismissed': 'true',
            'pplx.la-status': 'allowed',
            '__ps_r': '_',
            '__ps_sr': '_',
            '__ps_fva': str(current_time * 1000),
            '_fbp': f'fb.1.{current_time}.{uuid.uuid4().hex}',
            'pplx.metadata': json.dumps({
                "qc": 2,
                "qcu": 0,
                "qcm": 0,
                "qcc": 0,
                "qcco": 0,
                "qccol": 0,
                "qcdr": 0,
                "qcs": 0,
                "qcd": 0,
                "hli": False,
                "hcga": False,
                "hcds": False,
                "hso": False,
                "hfo": False,
                "hsco": False,
                "hfco": False,
                "hsma": False,
                "hdc": False,
                "fqa": current_time * 1000,
                "lqa": current_time * 1000
            })
        }
        
        all_cookies = {**base_cookies, **additional_cookies}
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Redmi 8A Dual Build/QKQ1.191014.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.7499.34 Mobile Safari/537.36',
            'Accept': 'text/event-stream',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Content-Type': 'application/json',
            'x-request-id': request_id,
            'sec-ch-ua-platform': '"Android"',
            'sec-ch-ua': '"Android WebView";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?1',
            'x-perplexity-request-reason': 'perplexity-query-state-provider',
            'origin': 'https://www.perplexity.ai',
            'x-requested-with': 'mark.via.gp',
            'sec-fetch-site': 'same-origin',
            'sec-fetch-mode': 'cors',
            'sec-fetch-dest': 'empty',
            'referer': 'https://www.perplexity.ai/search/hi-lMwqBQEoQRKoNpRoTe6QRA',
            'accept-language': 'en-GB,en-US;q=0.9,en;q=0.8',
            'priority': 'u=1, i',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
        
        if csrf_token and csrf_token != f'{uuid.uuid4().hex}%7C{uuid.uuid4().hex}':
            headers['x-csrf-token'] = csrf_token
        
        time.sleep(0.5)
        
        response = session.post(api_url, json=payload, headers=headers, cookies=all_cookies, timeout=120)
        
        if response.status_code != 200:
            return jsonify({
                'status': 'error',
                'message': f'Failed to fetch data: HTTP {response.status_code}',
                'response_text': response.text[:500],
                'apidev': '@ISmartCoder',
                'api_channel': '@abirxdhackz'
            }), 500
        
        full_response = response.text
        answer_text, sources, metadata = parse_response(full_response)
        
        debug_mode = request.args.get('debug', 'false').lower() == 'true'
        
        response_data = {
            'status': 'success',
            'prompt': prompt,
            'answer': answer_text if answer_text else "No answer received",
            'sources': sources,
            'metadata': metadata,
            'mode': mode,
            'model': model,
            'timestamp': current_time,
            'apidev': '@ISmartCoder',
            'api_channel': '@abirxdhackz'
        }
        
        if debug_mode:
            response_data['raw_response'] = full_response
        
        return jsonify(response_data), 200
        
    except requests.exceptions.Timeout:
        return jsonify({
            'status': 'error',
            'message': 'Request timeout',
            'apidev': '@ISmartCoder',
            'api_channel': '@abirxdhackz'
        }), 504
        
    except requests.exceptions.RequestException as e:
        return jsonify({
            'status': 'error',
            'message': f'Request failed: {str(e)}',
            'apidev': '@ISmartCoder',
            'api_channel': '@abirxdhackz'
        }), 500
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'message': f'Internal error: {str(e)}',
            'apidev': '@ISmartCoder',
            'api_channel': '@abirxdhackz'
        }), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)